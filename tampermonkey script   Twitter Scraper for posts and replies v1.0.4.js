// ==UserScript==
// @name         Twitter Scraper for posts and replies
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @description  Scrapes Twitter user's timeline with replies, handles infinite scroll, structures tweets into reply chains, and outputs as Markdown.
// @author       WXP, DeepseekR1
// @match        https://x.com/*/with_replies
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let scrapedData = [];
    let scrollInterval;
    const account = window.location.pathname.split('/')[1]; // Extract account name from URL

    function startScraping() {
        scrapedData = [];
        console.log('Scraping started with smoother scrolling...');
        scrollInterval = setInterval(() => {
            window.scrollBy(0, window.innerHeight * 0.8);
            extractTweets();
        }, 1000);  // Faster scrolling interval
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

            // Define the CSS classes for detection
            const isReply = !!tweet.querySelector('div.css-175oi2r.r-1bimlpy.r-f8sm7e.r-m5arl1.r-1p0dtai.r-1d2f490.r-u8s1d.r-zchlnj.r-ipm5af');
            const hasReplies = !!tweet.querySelector('div.css-175oi2r.r-1bimlpy.r-f8sm7e.r-m5arl1.r-16y2uox.r-14gqq1x');

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
            console.log(`Scraped tweet: ${tweetData.id}`, tweetData);
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

    // Add control buttons
    const startButton = document.createElement('button');
    startButton.textContent = 'Start Scraping';
    startButton.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;padding:8px;background:#1da1f2;color:white;border:none;border-radius:4px;cursor:pointer;';
    startButton.onclick = startScraping;
    document.body.appendChild(startButton);

    const stopButton = document.createElement('button');
    stopButton.textContent = 'Stop and Download';
    stopButton.style.cssText = 'position:fixed;top:10px;left:120px;z-index:9999;padding:8px;background:#e0245e;color:white;border:none;border-radius:4px;cursor:pointer;';
    stopButton.onclick = stopAndDownload;
    document.body.appendChild(stopButton);
})();