* ### 0.6.21 -- 3/16/19 by DW
   * Change in settings
      * The name of the "Reader URL" option was confusing, what it's really doing is providing a link for viewing the XML of a feed. This is necessary because browsers routinely try to provide a friendly display of a feed, when sometimes you need to see the XML of the feed itself.  I changed the label to "XML viewer URL" and the placeholder text changed from "URL of the app to read RSS feeds" to "URL of the app to view RSS feeds as XML."
   * When you upload your OPML, the View my OPML command in the Main menu is disabled. That's because appPrefs.opmlUrl is undefined.
      * This happens because we redirect to your subs page before the update to appPrefs is sent back to the server. 
* ### 0.6.11 -- 4/6/18 by DW
   * Unicode in feedBase. It wasn't easy, but it appears to be done. This is what we did. 
      * 1. Added <i>charset</i> value of utf8mb4 to the database object in <a href="https://github.com/scripting/feedBase/blob/master/docs/config.md">config.json</a>. 
      * 2. Ran 4 commands at the mysql command line. 
         * * ALTER DATABASE feedbase CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
         * * ALTER TABLE feeds CHANGE title title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
         * * ALTER TABLE feeds CHANGE description description VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
         * * ALTER TABLE subscriptions CHANGE username username VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      * 3. Installed the new version of feedBase that now uses the <a href="https://www.npmjs.com/package/davefeedread">davefeedread</a> package to read feeds. It respects the charset value in the content-type header. 
      * 4. Got my backup/restore act together so if any of these changed did harm to the database we'd have a chance of restoring things. 
   * A megathread in the issues part of the feedBase repo, and many thanks to JYStervinou and Thejeshgn. 
   * There was even a <a href="http://scripting.com/2018/04/06.html#a153548">podcast</a> done in the process of getting this to work! :rocket:
   * Also <a href="https://mathiasbynens.be/notes/mysql-utf8mb4">this post</a> was very helpful in providing the full picture. 
* ### 0.5.8 -- 3/10/18 by DW
   * There have been lots of changes, unfortunately not recorded. 
   * A death in the family caused a serious pause in development work on feedBase. 
   * I am back in the flow, mostly, and will attempt to resume the change notes. 
* ### 0.4.18 -- 2/4/18 by DW
   * Sorry I've been slacking off on the change notes. Getting back on the wagon.
   * Big change in this release -- we're now regularly updating the info we have about the feeds, one update every five seconds. That's of course configurable. We may need to decrease it, or rely on River5 to do this for us. For now this seems like enough.
   * Added two new columns to the feeds table: code and ctsecs, which are the HTTP code for the most recent request, and ctsecs the number of seconds, as a floating point number, that the request took. I want to add more info, the number of reads, number of consecutive errors. It's a beginning of helping spot feeds that are broken or no longer updating. Certainly something feedBase should track.
* ### 0.4.15 -- 2/2/18 by DW
   * New calls for getting a user's subscription data and the followers for a given feed. 
* ### 0.4.14 -- 2/1/18 by DW
   * Added everySecond and everyMinute scripts. 
   * Read config.json at the top of every minute, so you don't have to restart the app to reconfigure. Not all config options will take effect without a restart, for example HTTP port. 
* ### v0.4.12 -- 1/31/18 by DW
   * There's now a placeholder page at http://feedbase.io/.
* ### v0.4.11 -- 1/31/18 by DW
   * There's a new HTTP call -- /getopmlsubs -- It takes one param, username, and it returns the OPML for the feeds the user is subscribed to. 
   * The info comes out of the database, not from the OPML that the user entered. So it has the effect of normalizing the data, and over time since we will keep the <i>feeds</i> table updated, will provide a way for feeds to correct the information about them.
   * Note that this is public. You don't need to be me to read this data. This is establishing the principle that this is a publishing system. When you upload your OPML it's public. 
   * Here's the URL that gets my subscriptions.
   * http://feedbase.io:1405/getopmlsubs?username=davewiner
   * Note: I went ahead and bought the feedbase.io name. I'm putting a few weeks into the project, it's worth paying $50 a year to give it a proper domain. I will get rid of the :1405 part of the name soon.
