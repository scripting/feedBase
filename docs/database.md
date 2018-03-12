## Database structure for feedBase

There are two tables, feeds and subscriptions.

### feeds

Each element in the <i>feeds</i> table represents one feed. 

1. feedUrl -- the URL of the feed.

2. title -- the title, comes from the top-level &lt;title> element of the feed. 

3. htmlUrl -- links to the HTML page corresponding to the feed, comes from the top-level &lt;link> element of the feed. 

4. description -- the description, comes from the top-level &lt;description> element of the feed.

11. ctChecks -- the number of times the feed was read.

5. whenUpdated -- the last time the feed was read to update the information we maintain about it.

7. ctSecs -- how long it took to read the feed, the last time it was read.

8. code -- the HTTP code returned the last time the feed was read.

9. ctErrors -- the number of times there was an error updating the feed. 

10. ctConsecutiveErrors -- the number of consecutive errors. 

12. whenLastError -- the last time there was an error reading the feed. 

6. countSubs -- the number of subscribers. 

