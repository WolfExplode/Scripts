// ==UserScript==
// @name         Twitter Scraper for posts and replies - Customizable
// @namespace    http://tampermonkey.net/
// @version      1.0.6
// @description  Scrapes Twitter user's timeline with replies, handles infinite scroll, structures tweets into reply chains, and outputs as Markdown. Now with customizable CSS selectors that auto-format!
// @author       WXP, DeepseekR1, Gemini
// @match        https://*.twitter.com/*
// @match        https://*.x.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let scrapedData = [];
    let scrollInterval;
    const account = window.location.pathname.split('/')[1]; // Extract account name from URL

    // **Default CSS Selectors (can be changed via UI input)**
    let isReplySelector = 'div.css-175oi2r.r-1bnu78o.r-f8sm7e.r-m5arl1.r-1p0dtai.r-1d2f490.r-u8s1d.r-zchlnj.r-ipm5af';
    let hasRepliesSelector = 'div.css-175oi2r.r-1bnu78o.r-f8sm7e.r-m5arl1.r-16y2uox.r-14gqq1x';

    // UI elements
    let isReplyInput, hasRepliesInput;

    /**
     * Cleans up raw class lists copied from DevTools into a valid CSS selector string.
     * It handles:
     * 1. Leading/trailing spaces.
     * 2. Replaces all space separators with a period (.) for a combined class selector.
     * 3. Ensures the string starts with a proper selector type (e.g., 'div').
     * @param {string} rawSelector - The raw string from the input field.
     * @returns {string} A valid CSS selector.
     */
    function cleanCssSelector(rawSelector) {
        if (!rawSelector) return '';

        let cleaned = rawSelector.trim();

        // Find the element type (e.g., 'div') if it exists, otherwise assume 'div' (common for Twitter)
        let elementPrefix = 'div';
        const parts = cleaned.split(/\s+/);

        // Check if the first part looks like a common element tag (e.g., div, span)
        if (['div', 'span', 'a', 'article', 'button', 'time'].includes(parts[0].toLowerCase())) {
            elementPrefix = parts[0].toLowerCase();
            parts.shift(); // Remove the element tag from the list of classes
        }

        // Remove empty strings and join the remaining classes with a dot
        const classes = parts.filter(p => p.length > 0).join('.');

        // If there are no classes, return the original raw selector as a fallback (though highly unlikely)
        if (!classes) {
            return rawSelector.trim();
        }

        // Return the element prefix followed by the classes separated by dots
        return `${elementPrefix}.${classes}`;
    }

    function startScraping() {
        // Read the latest CSS values from the inputs and clean them
        if (isReplyInput && isReplyInput.value) {
            isReplySelector = cleanCssSelector(isReplyInput.value);
            console.log(`Using custom isReply selector: ${isReplySelector}`);
        }
        if (hasRepliesInput && hasRepliesInput.value) {
            hasRepliesSelector = cleanCssSelector(hasRepliesInput.value);
            console.log(`Using custom hasReplies selector: ${hasRepliesSelector}`);
        }

        scrapedData = [];
        console.log('Scraping started with smoother scrolling...');
        scrollInterval = setInterval(() => {
            window.scrollBy(0, window.innerHeight * 0.8);
            extractTweets();
        }, 1500);  // Faster scrolling interval
    }

    function extractTweets() {
        const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

        tweetElements.forEach(tweet => {
            // Skip retweets
            const socialContext = tweet.querySelector('[data-testid="socialContext"]');
            if (socialContext && /repost/i.test(socialContext.innerText)) {
                return;
            }

            const tweetLinkElement = tweet.querySelector('a[href*="/status/"]');
            const tweetId = tweetLinkElement?.href;

            if (!tweetId || scrapedData.some(t => t.id === tweetId)) return;

            const tweetTextElement = tweet.querySelector('[data-testid="tweetText"]');
            const timeElement = tweet.querySelector('time');

            // Define the CSS classes for detection using the stored (and potentially updated) selectors
            // Use the cleaned selectors here:
            const isReply = !!tweet.querySelector(isReplySelector);
            const hasReplies = !!tweet.querySelector(hasRepliesSelector);

            const tweetData = {
                id: tweetId,
                authorName: tweet.querySelector('div[data-testid="User-Name"] a:not([tabindex="-1"]) span span')?.innerText || '',
                authorHandle: tweet.querySelector('div[data-testid="User-Name"] a[tabindex="-1"] span')?.innerText || '',
                text: tweetTextElement?.innerText || '',
                timestamp: timeElement?.getAttribute('datetime') || '',
                isReply: isReply,
                hasReplies: hasReplies,
                replies: []
            };

            scrapedData.push(tweetData);
        });
    }

    function stopAndDownload() {
        clearInterval(scrollInterval);
        console.log('Scraping stopped. Processing data...');

        // Build reply chains using stack method
        const rootTweets = [];
        const stack = [];

        scrapedData.forEach(tweet => {
            // Clear stack when encountering a new root tweet
            if (!tweet.isReply) {
                stack.length = 0;
            }

            // Add to parent's replies if available
            if (tweet.isReply && stack.length > 0) {
                const parent = stack[stack.length - 1];
                parent.replies.push(tweet);
            }

            // Update stack
            if (tweet.hasReplies) {
                stack.push(tweet);
            } else if (tweet.isReply) {
                // Remove parent if it has no more expected replies
                while (stack.length > 0 && !stack[stack.length - 1].hasReplies) {
                    stack.pop();
                }
            }

            // Collect root tweets
            if (!tweet.isReply) {
                rootTweets.push(tweet);
            }
        });

        console.log(`Found ${rootTweets.length} root threads. Generating Markdown...`);
        generateMarkdown(rootTweets, `${account}_tweets_structured.md`);
    }

	function generateMarkdown(rootTweets, filename) {
		let mdContent = "";

		function processTweet(tweet, depth) {
			const indent = "\t".repeat(depth);
			const date = tweet.timestamp.substring(0, 10); // YYYY-MM-DD

			// Add author handle and date link
			mdContent += `${indent}**${tweet.authorHandle}** [${date}](${tweet.id})\n`;

			// Add tweet text with preserved newlines
			const textLines = tweet.text.split("\n");
			for (const line of textLines) {
				// Wrap standalone URLs in parentheses
				const formattedLine = line.replace(/\b(https?:\/\/[^\s]+)\b/g, '($1)');
				mdContent += `${indent}${formattedLine}\n`;
			}

			// Process replies recursively
			for (const reply of tweet.replies) {
				processTweet(reply, depth + 1);
			}
		}

		// Process all root tweets
		for (let i = 0; i < rootTweets.length; i++) {
			processTweet(rootTweets[i], 0);
			if (i < rootTweets.length - 1) {
				mdContent += "\n"; // Single newline between threads
			}
		}

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

    const uiContainer = document.createElement('div');
    uiContainer.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;padding:8px;background:rgba(255, 255, 255, 0.9);border:1px solid #ccc;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);display:flex;flex-direction:column;gap:5px;';

    // Start Button
    const startButton = document.createElement('button');
    startButton.textContent = 'Start Scraping';
    startButton.style.cssText = 'padding:8px;background:#1da1f2;color:white;border:none;border-radius:4px;cursor:pointer;';
    startButton.onclick = startScraping;
    uiContainer.appendChild(startButton);

    // Stop Button
    const stopButton = document.createElement('button');
    stopButton.textContent = 'Stop and Download';
    stopButton.style.cssText = 'padding:8px;background:#e0245e;color:white;border:none;border-radius:4px;cursor:pointer;';
    stopButton.onclick = stopAndDownload;
    uiContainer.appendChild(stopButton);

    // isReply Input
    isReplyInput = document.createElement('input');
    isReplyInput.type = 'text';
    isReplyInput.value = isReplySelector;
    isReplyInput.placeholder = 'CSS for isReply (e.g., div css-175oi2r r-1bnu78o...)';
    isReplyInput.title = 'CSS selector for detecting a reply tweet. Copy the class list with spaces, the script will add the dots.';
    isReplyInput.style.cssText = 'padding:4px;border:1px solid #ccc;border-radius:3px;font-size:10px;width:300px;';

    const isReplyLabel = document.createElement('label');
    isReplyLabel.textContent = 'isReply CSS:';
    isReplyLabel.style.cssText = 'font-size:10px;font-weight:bold;';
    uiContainer.appendChild(isReplyLabel);
    uiContainer.appendChild(isReplyInput);

    // hasReplies Input
    hasRepliesInput = document.createElement('input');
    hasRepliesInput.type = 'text';
    hasRepliesInput.value = hasRepliesSelector;
    hasRepliesInput.placeholder = 'CSS for hasReplies (e.g., div css-175oi2r r-1bnu78o...)';
    hasRepliesInput.title = 'CSS selector for detecting a thread/tweet that has replies. Copy the class list with spaces, the script will add the dots.';
    hasRepliesInput.style.cssText = 'padding:4px;border:1px solid #ccc;border-radius:3px;font-size:10px;width:300px;';

    const hasRepliesLabel = document.createElement('label');
    hasRepliesLabel.textContent = 'hasReplies CSS:';
    hasRepliesLabel.style.cssText = 'font-size:10px;font-weight:bold;';
    uiContainer.appendChild(hasRepliesLabel);
    uiContainer.appendChild(hasRepliesInput);

    document.body.appendChild(uiContainer);
    // --- End UI Setup ---

})();
