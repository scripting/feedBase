### 0.4.14 -- 2/1/18 by DW

Added everySecond and everyMinute scripts. 

Read config.json at the top of every minute, so you don't have to restart the app to reconfigure. Not all config options will take effect without a restart, for example HTTP port. 

### v0.4.12 -- 1/31/18 by DW

There's now a placeholder page at http://feedbase.io/.

### v0.4.11 -- 1/31/18 by DW

There's a new HTTP call -- /getopmlsubs -- It takes one param, username, and it returns the OPML for the feeds the user is subscribed to. 

The info comes out of the database, not from the OPML that the user entered. So it has the effect of normalizing the data, and over time since we will keep the <i>feeds</i> table updated, will provide a way for feeds to correct the information about them.

Note that this is public. You don't need to be me to read this data. This is establishing the principle that this is a publishing system. When you upload your OPML it's public. 

Here's the URL that gets my subscriptions.

http://feedbase.io:1405/getopmlsubs?username=davewiner

Note: I went ahead and bought the feedbase.io name. I'm putting a few weeks into the project, it's worth paying $50 a year to give it a proper domain. I will get rid of the :1405 part of the name soon.

