// ==UserScript==
// @name         Twitter Scraper for /with_replies
// @namespace    http://tampermonkey.net/
// @version      0.1.3
// @description  Scrapes Twitter /with_replies page with conversation-aware sorting
// @author       WXP
// @match        https://*.twitter.com/*/with_replies
// @match        https://*.x.com/*/with_replies
// @grant        GM_getResourceText
// @resource     EMOJI_MAP https://raw.githubusercontent.com/WolfExplode/Scripts/main/emoji-map.json
// ==/UserScript==

(function() {
    'use strict';

    let scrapedData = [];
    let scrollInterval;
    const account = window.location.pathname.split('/')[1];
    const profileHandle = `@${account}`;

    let emojiMapCache = null;

    // Optional "start from this tweet" gating
    let startFromTweetId = null; // full status URL (as used by tweet.id)
    let startFromTweetExclusive = false; // if true: resume *after* this tweet (skip the match)
    let hasReachedStartTweet = false;

    // Auto-stop detection
    let autoStopEnabled = true;
    let autoDownloadOnAutoStop = true;
    let consecutiveNoNewTicks = 0;
    let lastScrollY = 0;
    let lastScrollHeight = 0;
    const MAX_NO_NEW_TICKS = 8; // ~12s with 1500ms interval

    // Picker-mode state
    let isPickingStartTweet = false;
    let lastHighlightedTweet = null;
    const PICK_HIGHLIGHT_STYLE = '3px solid #1da1f2';
    let priorOutline = '';
    let priorOutlineOffset = '';

    // Auto-scroll-to-text state (QoL tool; independent from scraping)
    let autoScrollToTextInterval = null;
    let autoScrollNeedle = '';
    let autoScrollTicks = 0;
    let autoScrollStartMs = 0;
    let autoScrollStalledTicks = 0;
    let autoScrollLastScrollY = 0;
    let autoScrollLastScrollH = 0;
    let autoScrollLastHighlightedTweet = null;
    let autoScrollPriorOutline = '';
    let autoScrollPriorOutlineOffset = '';
    const AUTO_SCROLL_HIGHLIGHT_STYLE = '3px solid #f59e0b';
    const AUTO_SCROLL_TICK_MS = 850;
    const AUTO_SCROLL_MAX_TICKS = 6000; // safety limit (~85 minutes)

    const STORAGE_KEYS = {
        startTweetId: 'wxp_tw_scraper_start_tweet_id',
        startTweetExclusive: 'wxp_tw_scraper_start_tweet_exclusive'
    };

    function setUiStatus(text) {
        const el = document.getElementById('wxp-scraper-status');
        if (el) el.textContent = text || '';
    }

    function setAutoScrollStatus(text) {
        const el = document.getElementById('wxp-autoscroll-status');
        if (el) el.textContent = text || '';
    }

    function findFirstTweetContainingText(needle) {
        const n = String(needle || '');
        if (!n) return null;

        const tweetEls = document.querySelectorAll('article[data-testid="tweet"]');
        for (let i = 0; i < tweetEls.length; i++) {
            const tweet = tweetEls[i];
            const tweetTextEl = tweet.querySelector?.('[data-testid="tweetText"]');
            const hay = (tweetTextEl?.innerText || tweet?.innerText || '').trim();
            if (hay && hay.includes(n)) return tweet;
        }
        return null;
    }

    function applyAutoScrollHighlight(tweetEl) {
        if (!tweetEl) return;
        if (autoScrollLastHighlightedTweet === tweetEl) return;

        if (autoScrollLastHighlightedTweet && autoScrollLastHighlightedTweet !== tweetEl) {
            autoScrollLastHighlightedTweet.style.outline = autoScrollPriorOutline || '';
            autoScrollLastHighlightedTweet.style.outlineOffset = autoScrollPriorOutlineOffset || '';
        }

        autoScrollPriorOutline = tweetEl.style.outline;
        autoScrollPriorOutlineOffset = tweetEl.style.outlineOffset;
        tweetEl.style.outline = AUTO_SCROLL_HIGHLIGHT_STYLE;
        tweetEl.style.outlineOffset = '2px';
        autoScrollLastHighlightedTweet = tweetEl;
    }

    function clearAutoScrollHighlight() {
        if (!autoScrollLastHighlightedTweet) return;
        autoScrollLastHighlightedTweet.style.outline = autoScrollPriorOutline || '';
        autoScrollLastHighlightedTweet.style.outlineOffset = autoScrollPriorOutlineOffset || '';
        autoScrollLastHighlightedTweet = null;
        autoScrollPriorOutline = '';
        autoScrollPriorOutlineOffset = '';
    }

    function stopAutoScrollToText(reason) {
        if (autoScrollToTextInterval) {
            clearInterval(autoScrollToTextInterval);
            autoScrollToTextInterval = null;
        }
        autoScrollNeedle = '';
        autoScrollTicks = 0;
        autoScrollStartMs = 0;
        autoScrollStalledTicks = 0;
        autoScrollLastScrollY = 0;
        autoScrollLastScrollH = 0;

        const btn = document.getElementById('wxp-autoscroll-btn');
        if (btn) btn.textContent = 'Scroll to text';

        if (reason) setAutoScrollStatus(reason);
    }

    function startAutoScrollToText(needle) {
        const n = String(needle || '').trim();
        if (!n) {
            setAutoScrollStatus('Auto-scroll: enter a target string first.');
            return;
        }

        if (autoScrollToTextInterval) {
            stopAutoScrollToText('Auto-scroll: stopped.');
            return;
        }

        autoScrollNeedle = n;
        autoScrollTicks = 0;
        autoScrollStartMs = Date.now();
        autoScrollStalledTicks = 0;
        autoScrollLastScrollY = window.scrollY;
        autoScrollLastScrollH = document.documentElement.scrollHeight;

        const btn = document.getElementById('wxp-autoscroll-btn');
        if (btn) btn.textContent = 'Stop scrolling';

        setAutoScrollStatus(`Auto-scroll: searching for “${n}” …`);

        autoScrollToTextInterval = setInterval(() => {
            autoScrollTicks++;

            const matchTweet = findFirstTweetContainingText(autoScrollNeedle);
            if (matchTweet) {
                applyAutoScrollHighlight(matchTweet);
                try {
                    matchTweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch {
                    // ignore
                }
                const secs = Math.max(0, Math.round((Date.now() - autoScrollStartMs) / 1000));
                stopAutoScrollToText(`Auto-scroll: found match after ${secs}s.`);
                return;
            }

            // Scroll down to load more
            const beforeY = window.scrollY;
            const beforeH = document.documentElement.scrollHeight;
            window.scrollBy(0, Math.max(400, Math.floor(window.innerHeight * 0.85)));
            const afterY = window.scrollY;
            const afterH = document.documentElement.scrollHeight;

            const didScroll = afterY !== beforeY;
            const didGrow = afterH !== beforeH;
            if (!didScroll && !didGrow && afterY === autoScrollLastScrollY && afterH === autoScrollLastScrollH) {
                autoScrollStalledTicks++;
            } else {
                autoScrollStalledTicks = 0;
            }
            autoScrollLastScrollY = afterY;
            autoScrollLastScrollH = afterH;

            if (autoScrollTicks % 10 === 0) {
                const secs = Math.max(0, Math.round((Date.now() - autoScrollStartMs) / 1000));
                setAutoScrollStatus(`Auto-scroll: searching (${secs}s) …`);
            }

            if (isEndOfTimelineVisible() && autoScrollStalledTicks >= 3) {
                stopAutoScrollToText('Auto-scroll: reached end of timeline (no match found).');
                return;
            }

            if (autoScrollStalledTicks >= 12) {
                stopAutoScrollToText('Auto-scroll: stalled (no new content). Try again or scroll manually a bit.');
                return;
            }

            if (autoScrollTicks >= AUTO_SCROLL_MAX_TICKS) {
                stopAutoScrollToText('Auto-scroll: stopped (safety limit reached).');
            }
        }, AUTO_SCROLL_TICK_MS);
    }

    function formatStartTweetStatus() {
        if (!startFromTweetId) return 'Start tweet: (none)';
        return startFromTweetExclusive
            ? `Resume after: ${startFromTweetId}`
            : `Start tweet: ${startFromTweetId}`;
    }

    function loadStartTweetCheckpoint() {
        try {
            const savedId = localStorage.getItem(STORAGE_KEYS.startTweetId);
            const savedExclusive = localStorage.getItem(STORAGE_KEYS.startTweetExclusive);
            if (savedId) {
                startFromTweetId = savedId;
                startFromTweetExclusive = savedExclusive === 'true';
            }
        } catch {
            // ignore
        }
    }

    function saveStartTweetCheckpoint() {
        try {
            if (!startFromTweetId) {
                localStorage.removeItem(STORAGE_KEYS.startTweetId);
                localStorage.removeItem(STORAGE_KEYS.startTweetExclusive);
                return;
            }
            localStorage.setItem(STORAGE_KEYS.startTweetId, startFromTweetId);
            localStorage.setItem(STORAGE_KEYS.startTweetExclusive, String(!!startFromTweetExclusive));
        } catch {
            // ignore
        }
    }

    function isEndOfTimelineVisible() {
        // Best-effort: detect "end" messaging Twitter/X sometimes shows.
        const endTexts = [
            "you’re all caught up",
            "you're all caught up",
            "you have caught up",
            "you’ve reached the end",
            "you've reached the end",
            "nothing to see here",
            "no more posts",
            "no more tweets",
            "end of results",
            "end of the results"
        ];

        const candidates = document.querySelectorAll('div[role="status"], div[aria-live], span, div');
        for (let i = 0; i < candidates.length; i++) {
            const t = (candidates[i]?.textContent || '').trim().toLowerCase();
            if (!t) continue;
            for (const endText of endTexts) {
                if (t.includes(endText)) return true;
            }
        }
        return false;
    }

    function stopScrapingInterval(reason) {
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
        if (reason) console.log(reason);
        setUiStatus(reason || 'Stopped.');
    }

    function normalizeStatusUrl(url) {
        if (!url) return '';
        try {
            const u = new URL(url, window.location.origin);
            // Strip query/hash to make matching stable
            u.search = '';
            u.hash = '';
            return u.toString();
        } catch {
            return url;
        }
    }

    function escapeMarkdownInlineText(text) {
        // Prevent Obsidian/CommonMark from treating usernames like @h____n900 as emphasis.
        // Escape the most common inline-markdown control chars.
        return String(text || '')
            .replace(/\\/g, '\\\\')
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_')
            .replace(/`/g, '\\`')
            .replace(/\[/g, '\\[')
            .replace(/]/g, '\\]');
    }

    function escapeMarkdownInlineTextPreservingUrls(line) {
        // Escape inline markdown controls, but keep URLs intact (URLs often contain "_" etc).
        const urls = [];
        const withTokens = String(line || '').replace(/\bhttps?:\/\/[^\s)]+/gi, (url) => {
            const token = `\u001AURL${urls.length}\u001A`;
            urls.push(url);
            return token;
        });

        const escaped = escapeMarkdownInlineText(withTokens);
        return escaped.replace(/\u001AURL(\d+)\u001A/g, (_, i) => urls[Number(i)] || '');
    }

    function getTweetIdFromTweetEl(tweetEl) {
        const a = tweetEl?.querySelector?.('a[href*="/status/"]');
        return normalizeStatusUrl(a?.href || '');
    }

    function clearStartTweetSelection() {
        startFromTweetId = null;
        startFromTweetExclusive = false;
        hasReachedStartTweet = true; // no gate
        saveStartTweetCheckpoint();
        setUiStatus(formatStartTweetStatus());
    }

    function applyHighlight(tweetEl) {
        if (!tweetEl) return;
        // If we're still on the same tweet, don't re-apply styles (avoids clobbering priorOutline).
        if (lastHighlightedTweet === tweetEl) return;
        // Restore previous highlight
        if (lastHighlightedTweet && lastHighlightedTweet !== tweetEl) {
            lastHighlightedTweet.style.outline = priorOutline || '';
            lastHighlightedTweet.style.outlineOffset = priorOutlineOffset || '';
        }
        // Save current tweet's prior styles (only once per element swap)
        priorOutline = tweetEl.style.outline;
        priorOutlineOffset = tweetEl.style.outlineOffset;
        tweetEl.style.outline = PICK_HIGHLIGHT_STYLE;
        tweetEl.style.outlineOffset = '2px';
        lastHighlightedTweet = tweetEl;
    }

    function clearHighlight() {
        if (!lastHighlightedTweet) return;
        lastHighlightedTweet.style.outline = priorOutline || '';
        lastHighlightedTweet.style.outlineOffset = priorOutlineOffset || '';
        lastHighlightedTweet = null;
        priorOutline = '';
        priorOutlineOffset = '';
    }

    function stopPickingMode() {
        if (!isPickingStartTweet) return;
        isPickingStartTweet = false;
        clearHighlight();
        setUiStatus(formatStartTweetStatus());
    }

    function startPickingMode() {
        isPickingStartTweet = true;
        setUiStatus('Picker mode: hover a tweet to highlight, click to select. Press Esc to cancel.');
    }

    function onPickerMouseMove(e) {
        if (!isPickingStartTweet) return;
        const tweet = e.target?.closest?.('article[data-testid="tweet"]');
        if (tweet) {
            applyHighlight(tweet);
        } else {
            clearHighlight();
        }
    }

    function onPickerClick(e) {
        if (!isPickingStartTweet) return;

        const tweet = e.target?.closest?.('article[data-testid="tweet"]');
        if (!tweet) return;

        e.preventDefault();
        e.stopPropagation();

        const pickedId = getTweetIdFromTweetEl(tweet);
        if (!pickedId) {
            setUiStatus('Could not read tweet URL from that element. Try clicking the timestamp/link area.');
            return;
        }

        startFromTweetId = pickedId;
        startFromTweetExclusive = false; // picker means "include this tweet"
        saveStartTweetCheckpoint();
        hasReachedStartTweet = false;
        stopPickingMode();
    }

    function onPickerKeyDown(e) {
        if (!isPickingStartTweet) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            stopPickingMode();
        }
    }

    function extractAvatarUrl(tweetEl) {
        if (!tweetEl) return '';

        // Prefer the explicit avatar container (stable testid).
        const img =
            tweetEl.querySelector('[data-testid="Tweet-User-Avatar"] img[src^="http"]') ||
            tweetEl.querySelector('[data-testid^="UserAvatar-Container"] img[src^="http"]') ||
            tweetEl.querySelector('img[src*="pbs.twimg.com/profile_images/"]');

        const directSrc = img?.getAttribute?.('src') || '';
        if (directSrc) return directSrc;

        // Fallback: some avatars may be set as background-image on a nested div.
        const bgEl =
            tweetEl.querySelector('[data-testid="Tweet-User-Avatar"] div[style*="background-image"]') ||
            tweetEl.querySelector('div[style*="background-image"][style*="profile_images"]');

        const style = bgEl?.getAttribute?.('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i);
        return match?.[1] || '';
    }

    function getEmojiMap() {
        // Optional optimization/accuracy layer.
        // Some Twitter emoji SVG filenames omit variation selectors (e.g. "263a.svg" maps to "☺️"),
        // so a URL->Unicode map can be more correct than filename parsing.
        if (emojiMapCache) return emojiMapCache;
        try {
            if (typeof GM_getResourceText === 'function') {
                const jsonText = GM_getResourceText('EMOJI_MAP');
                if (jsonText) {
                    emojiMapCache = JSON.parse(jsonText);
                    return emojiMapCache;
                }
            }
        } catch {
            // ignore, fallback logic below will handle missing map
        }
        emojiMapCache = null;
        return null;
    }

    function emojiUnicodeFromTwitterUrl(src) {
        if (!src) return null;

        // 1) Prefer explicit mapping if available (handles VS16/ZWJ edge cases).
        const emojiMap = getEmojiMap();
        if (emojiMap && typeof emojiMap === 'object' && emojiMap[src]) {
            return emojiMap[src];
        }

        // 2) Parse codepoints from URL filename: .../emoji/v2/svg/1f9e0.svg or 1f3f3-fe0f-200d-1f308.svg
        const match = src.match(/\/emoji\/v2\/svg\/([0-9a-f-]+)\.svg/i);
        if (!match) return null;

        const codepoints = match[1]
            .toLowerCase()
            .split('-')
            .filter(Boolean)
            .map(hex => Number.parseInt(hex, 16));

        if (codepoints.length === 0 || codepoints.some(n => !Number.isFinite(n))) return null;

        try {
            return String.fromCodePoint(...codepoints);
        } catch {
            return null;
        }
    }

    function toEmojiTextOrMarkdown(imgEl) {
        const alt = imgEl?.getAttribute?.('alt') || imgEl?.getAttribute?.('title') || '';
        const src = imgEl?.getAttribute?.('src') || '';

        // Primary: generate Unicode directly from the Twitter emoji SVG URL.
        const unicode = emojiUnicodeFromTwitterUrl(src);
        if (unicode) return unicode;

        // Secondary: Twitter often already provides the Unicode in `alt`.
        if (alt) return alt;

        // Fallback: do NOT emit markdown image syntax here, because tweet body text
        // gets markdown-escaped for Obsidian/CommonMark (which would break it).
        // If we can't map the emoji, just keep a placeholder.
        return 'emoji';
    }

    function extractTweetTextWithEmojis(rootEl) {
        if (!rootEl) return '';

        const out = [];

        // Some translation extensions (e.g. Immersive Translate) inject wrapper <font> nodes like:
        // .immersive-translate-target-wrapper -> (hidden <br>) -> .immersive-translate-target-inner
        // Prefer scraping the translated "inner" content to avoid duplicated/malformed output.
        const translatedInner =
            rootEl.querySelector?.('.immersive-translate-target-inner') ||
            rootEl.querySelector?.('.immersive-translate-target-translation-block-wrapper') ||
            rootEl.querySelector?.('[data-immersive-translate-translation-element-mark]');
        const effectiveRoot = translatedInner || rootEl;

        const walk = (node) => {
            if (!node) return;

            // Text node
            if (node.nodeType === Node.TEXT_NODE) {
                out.push(node.textContent || '');
                return;
            }

            // Element node
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = /** @type {HTMLElement} */ (node);
                const tag = (el.tagName || '').toUpperCase();

                // Skip hidden/aria-hidden nodes (translation tools often inject hidden separators).
                if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
                    return;
                }

                if (tag === 'IMG') {
                    out.push(toEmojiTextOrMarkdown(el));
                    return;
                }

                if (tag === 'BR') {
                    // Ignore hidden <br> (common in injected translation wrappers).
                    if (el.hasAttribute('hidden')) return;
                    out.push('\n');
                    return;
                }

                // Recurse children
                el.childNodes.forEach(walk);
            }
        };

        walk(effectiveRoot);
        return out.join('');
    }

    function startScraping() {
        scrapedData = [];
        console.log(`Scraping started for ${profileHandle}'s replies page...`);
        // Gate extraction until we hit the selected start tweet, if any.
        hasReachedStartTweet = !startFromTweetId;
        setUiStatus(formatStartTweetStatus());

        consecutiveNoNewTicks = 0;
        lastScrollY = window.scrollY;
        lastScrollHeight = document.documentElement.scrollHeight;

        scrollInterval = setInterval(() => {
            const beforeCount = scrapedData.length;
            const beforeY = window.scrollY;
            const beforeH = document.documentElement.scrollHeight;

            window.scrollBy(0, window.innerHeight * 0.8);
            extractTweets();

            const afterCount = scrapedData.length;
            const afterY = window.scrollY;
            const afterH = document.documentElement.scrollHeight;

            const didAddAny = afterCount > beforeCount;
            const didScroll = afterY !== beforeY;
            const didGrow = afterH !== beforeH;

            if (didAddAny) {
                consecutiveNoNewTicks = 0;
            } else {
                consecutiveNoNewTicks++;
            }

            // If we can no longer scroll AND no new tweets are being found, we are likely at the end.
            if (autoStopEnabled) {
                // If we're still waiting to reach the start tweet checkpoint, do NOT auto-stop.
                if (!hasReachedStartTweet && startFromTweetId) {
                    consecutiveNoNewTicks = 0;
                    lastScrollY = afterY;
                    lastScrollHeight = afterH;
                    setUiStatus(`Waiting for start tweet… ${formatStartTweetStatus()}`);
                    return;
                }

                const endVisible = isEndOfTimelineVisible();
                const stalledScroll = !didScroll && !didGrow && afterY === lastScrollY && afterH === lastScrollHeight;

                if (endVisible && consecutiveNoNewTicks >= 2) {
                    stopScrapingInterval(`Auto-stopped: end of timeline detected (tweets: ${afterCount}).`);
                    if (autoDownloadOnAutoStop) stopAndDownload();
                    return;
                }

                if (consecutiveNoNewTicks >= MAX_NO_NEW_TICKS && stalledScroll) {
                    stopScrapingInterval(`Auto-stopped: no new tweets detected (ticks: ${consecutiveNoNewTicks}, tweets: ${afterCount}).`);
                    if (autoDownloadOnAutoStop) stopAndDownload();
                    return;
                }
            }

            lastScrollY = afterY;
            lastScrollHeight = afterH;
        }, 1500);
    }

    function extractTweets() {
        const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

        tweetElements.forEach(tweet => {
            const socialContext = tweet.querySelector('[data-testid="socialContext"]');
            if (socialContext && /repost/i.test(socialContext.innerText)) {
                return;
            }

            const tweetLinkElement = tweet.querySelector('a[href*="/status/"]');
            const tweetId = normalizeStatusUrl(tweetLinkElement?.href);

            if (!tweetId || scrapedData.some(t => t.id === tweetId)) return;

            // If a start tweet was selected, skip everything until we reach it.
            if (!hasReachedStartTweet && startFromTweetId) {
                if (tweetId !== startFromTweetId) return;
                hasReachedStartTweet = true;
                if (startFromTweetExclusive) return; // resume AFTER this tweet
            }

            const tweetTextElement = tweet.querySelector('[data-testid="tweetText"]');
            const timeElement = tweet.querySelector('time');

            // Check for reply indicator (vertical line on left side)
            const isReply = !!tweet.querySelector(
                'div.css-175oi2r.r-18kxxzh.r-1wron08.r-onrtq4.r-15zivkp > ' +
                'div.css-175oi2r.r-1bnu78o.r-f8sm7e.r-m5arl1.r-1p0dtai.r-1d2f490.r-u8s1d.r-zchlnj.r-ipm5af'
            );

            const statsGroup = tweet.querySelector('div[role="group"][aria-label]');
            let hasReplies = false;
            if (statsGroup) {
                const ariaLabel = statsGroup.getAttribute('aria-label').toLowerCase();
                const replyMatch = ariaLabel.match(/(\d+)\s+repl/i);
                hasReplies = replyMatch && parseInt(replyMatch[1]) > 0;
            }

            const tweetData = {
                id: tweetId,
                authorName: tweet.querySelector('div[data-testid="User-Name"] a:not([tabindex="-1"]) span span')?.innerText || '',
                authorHandle: tweet.querySelector('div[data-testid="User-Name"] a[tabindex="-1"] span')?.innerText || '',
                authorAvatarUrl: extractAvatarUrl(tweet) || '',
                // `innerText` drops emoji <img> nodes; walk the tweetText DOM to preserve them.
                text: extractTweetTextWithEmojis(tweetTextElement) || '',
                timestamp: timeElement?.getAttribute('datetime') || '',
                isReply: isReply,
                hasReplies: hasReplies,
                replies: [] // For compatibility; will be rebuilt during processing
            };

            scrapedData.push(tweetData);
        });

        console.log(`Extracted ${scrapedData.length} tweets so far...`);
    }

    function stopAndDownload() {
        stopScrapingInterval(`Scraping stopped. Processing ${scrapedData.length} tweets...`);
        console.log(`Scraping stopped. Processing ${scrapedData.length} tweets...`);

        // Save a resume checkpoint: pick up *after* the last scraped tweet next time.
        // This is intentionally based on raw scrapedData (not the processed sequence).
        let lastId = '';
        for (let i = scrapedData.length - 1; i >= 0; i--) {
            const id = scrapedData[i]?.id;
            if (id) { lastId = id; break; }
        }
        if (lastId) {
            startFromTweetId = normalizeStatusUrl(lastId);
            startFromTweetExclusive = true;
            saveStartTweetCheckpoint();
        }

        // **Step 1 & 2: Identify root tweets and separate comment sections**
        // We loop through scrapedData (DOM order) and split it into sections
        // Each section contains one root tweet + its comment section (replies between this root and the next)
        const rootTweetData = [];
        let currentCommentSection = [];
        let currentRoot = null;

        scrapedData.forEach(tweet => {
            const isRootTweet = tweet.authorHandle === profileHandle && !tweet.isReply;
            
            if (isRootTweet) {
                // Finalize previous section before starting new one
                if (currentRoot) {
                    rootTweetData.push({
                        rootTweet: currentRoot,
                        commentSection: currentCommentSection
                    });
                }
                // Start new section with this root tweet
                currentRoot = tweet;
                currentCommentSection = [];
            } else if (currentRoot) {
                // This tweet belongs to the current root's comment section
                currentCommentSection.push(tweet);
            }
        });
        
        // Process the last section
        if (currentRoot) {
            rootTweetData.push({
                rootTweet: currentRoot,
                commentSection: currentCommentSection
            });
        }

        // **Step 3, 4, 5, 6: Process each root tweet's comment section**
        const finalSequence = [];
        
        rootTweetData.forEach((section, sectionIdx) => {
            // Add the root tweet (always at depth 0, in DOM order)
            finalSequence.push({...section.rootTweet, depth: 0});
            
            // **Step 4: Group comment section into threads by username**
            // Each thread is a conversation group: [userTweet, ownerReply, ...]
            const threads = groupCommentSectionIntoThreads(section.commentSection);
            
            // **Step 5: Chronologically sort tweets within each thread**
            // We sort threads by the timestamp of the first tweet in each thread
            // (which is the tweet @ownerHandle replied to, not their reply)
            threads.sort((threadA, threadB) => {
                // Find the first tweet in each thread (will be by user, not owner)
                const firstTweetA = threadA.find(t => t.authorHandle !== profileHandle) || threadA[0];
                const firstTweetB = threadB.find(t => t.authorHandle !== profileHandle) || threadB[0];
                
                return firstTweetA.timestamp.localeCompare(firstTweetB.timestamp);
            });
            
            // **Step 6: Flatten threads into final sequence with numbering and depth**
            threads.forEach((thread, threadIndex) => {
                thread.forEach((tweet, commentIndex) => {
                    const depth = commentIndex === 0 ? 1 : 2;
                    finalSequence.push({
                        ...tweet,
                        depth: depth,
                        threadNumber: threadIndex + 1,
                        commentNumber: commentIndex + 1
                    });
                });
            });
            
            // Add blank line between root tweets (but not after the last one)
            if (sectionIdx < rootTweetData.length - 1) {
                finalSequence.push({separator: true});
            }
        });
        
        console.log(`Processed ${rootTweetData.length} root tweet sections with conversation-aware sorting.`);
        generateMarkdown(finalSequence, `${account}_with_replies.md`);

        // Update status after download to show the saved checkpoint.
        setUiStatus(`Downloaded. ${formatStartTweetStatus()}`);
    }

    /**
     * **Step 4 Helper: Group comment section into "threads" (per commenter) with explicit pairing**
     *
     * Goal:
     * - Twitter's `/with_replies` timeline does not render full threads. It tends to show:
     *   - A commenter tweet (replying to the root OR replying to the owner's reply)
     *   - The profile owner's reply to that commenter tweet
     *
     * Approach:
     * - Use DOM adjacency to pair owner replies to the immediately preceding non-owner tweet.
     * - Group all non-owner tweets by the same commenter into a single thread for this root section.
     * - Within each thread, sort chronologically so the back-and-forth reads as a chain.
     *
     * Metadata:
     * - Non-owner tweets are treated as "parent" tweets for pairing purposes:
     *   - isParent: true
     *   - hasReply: boolean
     *   - replyIds: string[]
     * - Owner replies get:
     *   - isReply: true
     *   - parentId: <id of the non-owner tweet they reply to>
     */
    function groupCommentSectionIntoThreads(commentSection) {
        const threadsByHandle = new Map(); // handle -> tweet[]
        const firstSeenHandles = []; // stable ordering of threads

        let lastNonOwnerHandle = null;
        let lastNonOwnerTweetId = null;

        commentSection.forEach(tweet => {
            const isOwner = tweet.authorHandle === profileHandle;
            const isOwnerReply = isOwner && tweet.isReply;

            // Non-owner tweets are the anchor points ("parents") we can reliably see in /with_replies.
            if (!isOwner) {
                const handle = tweet.authorHandle || '';

                if (!threadsByHandle.has(handle)) {
                    threadsByHandle.set(handle, []);
                    firstSeenHandles.push(handle);
                }

                const parentTweet = {
                    ...tweet,
                    isParent: true,
                    hasReply: false,
                    replyIds: []
                };

                threadsByHandle.get(handle).push(parentTweet);
                lastNonOwnerHandle = handle;
                lastNonOwnerTweetId = tweet.id;
                return;
            }

            // Owner replies: pair to the immediately previous non-owner tweet (DOM adjacency assumption).
            if (isOwnerReply && lastNonOwnerHandle && threadsByHandle.has(lastNonOwnerHandle)) {
                const replyTweet = {
                    ...tweet,
                    isReply: true,
                    parentId: lastNonOwnerTweetId
                };

                const thread = threadsByHandle.get(lastNonOwnerHandle);
                thread.push(replyTweet);

                // Update the matching parent tweet (most recent one with lastNonOwnerTweetId).
                for (let i = thread.length - 1; i >= 0; i--) {
                    const t = thread[i];
                    if (t.isParent && t.id === lastNonOwnerTweetId) {
                        t.hasReply = true;
                        t.replyIds.push(tweet.id);
                        break;
                    }
                }
            }
        });

        // Convert to threads and sort chronologically within each thread.
        const threads = firstSeenHandles
            .map(handle => threadsByHandle.get(handle))
            .filter(thread => thread && thread.length > 0);

        threads.forEach(thread => {
            thread.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        });

        // Sort threads by when the conversation started (timestamp of first tweet in that thread).
        threads.sort((a, b) => (a[0]?.timestamp || '').localeCompare(b[0]?.timestamp || ''));

        return threads;
    }

    function isYouTubeUrl(urlString) {
        try {
            const u = new URL(urlString);
            const host = u.hostname.toLowerCase().replace(/^www\./, '');
            return (
                host === 'youtu.be' ||
                host === 'youtube.com' ||
                host === 'm.youtube.com' ||
                host === 'music.youtube.com'
            );
        } catch {
            return false;
        }
    }

    function stripYouTubeUrlsFromLine(line) {
        // Remove YouTube URLs entirely (e.g. https://youtu.be/... or https://www.youtube.com/watch?...).
        // Also normalizes leftover whitespace.
        const withoutYoutube = line.replace(/\bhttps?:\/\/[^\s)]+/gi, (url) => {
            return isYouTubeUrl(url) ? '' : url;
        });

        return withoutYoutube
            .replace(/\s{2,}/g, ' ')
            .replace(/\(\s*\)/g, '') // just in case we removed a url already wrapped by older output
            .trimEnd();
    }

    function looksLikeUrlContinuation(line) {
        const t = (line || '').trim();
        if (!t) return false;
        // Conservative "URL-ish" charset (no spaces). This matches pieces like:
        // - youtu.be/abc?si
        // - =K5JB73AM...
        // - &t=12s
        return /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/.test(t);
    }

    function stripYouTubeUrlsFromLines(lines) {
        // Twitter's tweetText innerText can split links across lines, e.g.:
        //   https://
        //   youtu.be/ID?si
        //   =XYZ
        //   …
        //
        // This removes such multi-line YouTube link blocks entirely.
        const out = [];

        for (let i = 0; i < lines.length; ) {
            const line = lines[i] ?? '';
            const trimmed = line.trim();

            const isBareScheme = /^https?:\/\/$/i.test(trimmed);
            if (isBareScheme && i + 1 < lines.length) {
                let j = i;
                const parts = [];

                // Collect the bare scheme + subsequent "URL-ish" fragments.
                while (j < lines.length) {
                    const part = (lines[j] ?? '').trim();
                    if (!part) break;

                    // Consume a trailing ellipsis line if it immediately follows the URL fragments.
                    if (part === '…' || part === '...') {
                        parts.push(part);
                        j++;
                        break;
                    }

                    if (!looksLikeUrlContinuation(part)) break;
                    parts.push(part);
                    j++;
                }

                const candidateWithEllipsis = parts.join('');
                const candidate = candidateWithEllipsis.replace(/[.…]+$/g, '');

                // If this reconstructed candidate is a YouTube URL, drop all consumed lines.
                if (isYouTubeUrl(candidate)) {
                    i = j;
                    continue;
                }
            }

            out.push(line);
            i++;
        }

        return out;
    }

    function wrapBareUrlsForMarkdown(line) {
        // Wrap plain URLs as "(url)" (your original output style),
        // but avoid touching URLs that are already inside markdown link/image syntax.
        //
        // Examples to NOT rewrite:
        // - ![Alt|18](https://abs-0.twimg.com/emoji/v2/svg/xxxx.svg)
        // - [text](https://example.com)
        return (line || '').replace(/(?<!\]\()(?<!\)\()(?<!\()https?:\/\/[^\s)]+/g, '($&)');
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        const parsed = new Date(timestamp);
        if (!Number.isFinite(parsed.getTime())) return timestamp;
        const formatted = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'UTC',
            timeZoneName: 'short'
        }).format(parsed);
        return formatted.replace(/,/g, '');
    }

    function formatTweet(tweet) {
        const indent = "\t".repeat(tweet.depth);
        const formattedTimestamp = formatTimestamp(tweet.timestamp) || 'unknown date';
        
        const hasRootLink = tweet.depth === 0;
        const dateLink = hasRootLink ? `[${formattedTimestamp}](${tweet.id})` : `[${formattedTimestamp}]`;
        const avatarMd = tweet.authorAvatarUrl ? `![|18](${tweet.authorAvatarUrl})` : '';
        const safeHandle = escapeMarkdownInlineText(tweet.authorHandle);
        let content = `${indent}${avatarMd}**${safeHandle}** ${dateLink}`;

        const textLines = stripYouTubeUrlsFromLines(tweet.text.split("\n"));
        if (textLines.length > 0 && textLines[0].trim()) {
            const textIndent = indent;
            const renderedLines = textLines
                .map(stripYouTubeUrlsFromLine)
                // NOTE: This intentionally removes *blank lines* from tweet text.
                // Twitter often includes empty lines in `innerText` (double newlines) for spacing.
                // Filtering them makes the exported markdown compact and (effectively) "removes line breaks"
                // between paragraphs by collapsing multiple consecutive newlines.
                .filter(line => line.trim().length > 0)
                .map(line => {
                    const formattedLine = wrapBareUrlsForMarkdown(line);
                    const safeLine = escapeMarkdownInlineTextPreservingUrls(formattedLine);
                    return `${textIndent}${safeLine}`;
                });

            if (renderedLines.length > 0) {
                content += "\n" + renderedLines.join("\n");
            }
        }

        return content + "\n";
    }

    function generateMarkdown(tweets, filename) {
        let mdContent = '';
        
        tweets.forEach(tweet => {
            if (tweet.separator) {
                mdContent += '\n'; // Blank line between root tweets
            } else {
                mdContent += formatTweet(tweet);
            }
        });
        
        downloadMarkdown(mdContent, filename);
    }

    function downloadMarkdown(content, filename) {
        const blob = new Blob([content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- UI Setup ---
    // Load any saved checkpoint before building UI (so the status line reflects it).
    loadStartTweetCheckpoint();

    const uiContainer = document.createElement('div');
    uiContainer.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;padding:8px;background:rgba(255, 255, 255, 0.9);border:1px solid #ccc;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);display:flex;flex-direction:column;gap:5px;';

    const statusLine = document.createElement('div');
    statusLine.id = 'wxp-scraper-status';
    statusLine.style.cssText = 'font:12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial;max-width:320px;color:#111;';
    statusLine.textContent = formatStartTweetStatus();
    uiContainer.appendChild(statusLine);

    const autoStopRow = document.createElement('label');
    autoStopRow.style.cssText = 'display:flex;align-items:center;gap:6px;font:12px system-ui, -apple-system, Segoe UI, Roboto, Arial;color:#111;user-select:none;';
    const autoStopCb = document.createElement('input');
    autoStopCb.type = 'checkbox';
    autoStopCb.checked = autoStopEnabled;
    autoStopCb.onchange = () => { autoStopEnabled = autoStopCb.checked; };
    autoStopRow.appendChild(autoStopCb);
    autoStopRow.appendChild(document.createTextNode('Auto-stop when no new tweets'));
    uiContainer.appendChild(autoStopRow);

    const autoDlRow = document.createElement('label');
    autoDlRow.style.cssText = 'display:flex;align-items:center;gap:6px;font:12px system-ui, -apple-system, Segoe UI, Roboto, Arial;color:#111;user-select:none;';
    const autoDlCb = document.createElement('input');
    autoDlCb.type = 'checkbox';
    autoDlCb.checked = autoDownloadOnAutoStop;
    autoDlCb.onchange = () => { autoDownloadOnAutoStop = autoDlCb.checked; };
    autoDlRow.appendChild(autoDlCb);
    autoDlRow.appendChild(document.createTextNode('Auto-download on auto-stop'));
    uiContainer.appendChild(autoDlRow);

    const pickStartButton = document.createElement('button');
    pickStartButton.textContent = 'Pick start tweet';
    pickStartButton.style.cssText = 'padding:8px;background:#6b7280;color:white;border:none;border-radius:4px;cursor:pointer;';
    pickStartButton.onclick = () => {
        // Avoid fighting scroll/hover while in picker mode.
        stopAutoScrollToText('Auto-scroll: stopped (picker mode).');
        if (isPickingStartTweet) {
            stopPickingMode();
            return;
        }
        startPickingMode();
    };
    uiContainer.appendChild(pickStartButton);

    const clearStartButton = document.createElement('button');
    clearStartButton.textContent = 'Clear start tweet';
    clearStartButton.style.cssText = 'padding:8px;background:#9ca3af;color:white;border:none;border-radius:4px;cursor:pointer;';
    clearStartButton.onclick = () => {
        stopPickingMode();
        clearStartTweetSelection();
    };
    uiContainer.appendChild(clearStartButton);

    // --- QoL: Auto-scroll until a specific text is rendered in a tweet ---
    const autoScrollLabel = document.createElement('div');
    autoScrollLabel.style.cssText = 'font:12px system-ui, -apple-system, Segoe UI, Roboto, Arial;color:#111;margin-top:4px;';
    autoScrollLabel.textContent = 'Auto-scroll to text (stops when found):';
    uiContainer.appendChild(autoScrollLabel);

    const autoScrollRow = document.createElement('div');
    autoScrollRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const autoScrollInput = document.createElement('input');
    autoScrollInput.type = 'text';
    autoScrollInput.placeholder = 'Paste a snippet from the target tweet…';
    autoScrollInput.style.cssText = 'flex:1;min-width:180px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font:12px system-ui, -apple-system, Segoe UI, Roboto, Arial;';

    const autoScrollBtn = document.createElement('button');
    autoScrollBtn.id = 'wxp-autoscroll-btn';
    autoScrollBtn.textContent = 'Scroll to text';
    autoScrollBtn.style.cssText = 'padding:8px;background:#f59e0b;color:#111;border:none;border-radius:4px;cursor:pointer;white-space:nowrap;';
    autoScrollBtn.onclick = () => startAutoScrollToText(autoScrollInput.value);

    autoScrollInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            autoScrollBtn.click();
        }
    });

    autoScrollRow.appendChild(autoScrollInput);
    autoScrollRow.appendChild(autoScrollBtn);
    uiContainer.appendChild(autoScrollRow);

    const autoScrollStatus = document.createElement('div');
    autoScrollStatus.id = 'wxp-autoscroll-status';
    autoScrollStatus.style.cssText = 'font:12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial;max-width:320px;color:#111;';
    autoScrollStatus.textContent = 'Auto-scroll: idle.';
    uiContainer.appendChild(autoScrollStatus);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Scraping';
    startButton.style.cssText = 'padding:8px;background:#1da1f2;color:white;border:none;border-radius:4px;cursor:pointer;';
    startButton.onclick = () => {
        stopAutoScrollToText('Auto-scroll: stopped (scraper started).');
        startScraping();
    };
    uiContainer.appendChild(startButton);

    const stopButton = document.createElement('button');
    stopButton.textContent = 'Stop and Download';
    stopButton.style.cssText = 'padding:8px;background:#e0245e;color:white;border:none;border-radius:4px;cursor:pointer;';
    stopButton.onclick = stopAndDownload;
    uiContainer.appendChild(stopButton);

    document.body.appendChild(uiContainer);

    // Global picker listeners (capture so we can stop click navigation reliably)
    document.addEventListener('mousemove', onPickerMouseMove, true);
    document.addEventListener('click', onPickerClick, true);
    document.addEventListener('keydown', onPickerKeyDown, true);
})();