## What is feedBase?

A project to get lots of feeds into a database.

### How it works

There are three types of nodes in our graph:

1. users

2. feeds 

3. subscriptions

The relationships we manage: users subscribe to feeds.

A user can enter subscriptions in two ways.

1. Upload an OPML subscription list. 

2. When browsing, click a button to subscribe or unsubscribe.

You can upload as many OPML subscription lists as you like.

We maintain a single public OPML subscription list for each user which reflects all the feeds they are currently subscribed to. This list can be accessed by feed reading software, so it's possible that feedBase can be a place to manage subscriptions you want to share with many feed-reading services 

The home page of the site is the top 100 list of feeds ranked by the number of subscribers.

You can click on a feed to see a page with information about the feed, and a list of users who subscribe to it. 

You can click on a name of a user to see the feeds they subscribe to. And on and on.

Periodically we read the feeds to keep our database of info about them up to date. 

### Why?

The world of news and blogs need glue. We'll never know how much stuff is going on until we start looking for it. In a sense it's like the first time around, when we <a href="https://en.wiktionary.org/wiki/put_out_feelers">put out feelers</a> of different kinds. Some worked others didn't. I remember this approach, the one I'm using in feedBase, working really well.

### Why now?

I'm ready to do it, it seems. I did a project late last year to learn how MySQL works in server apps written in Node, and this was a simple evolution of what I already had working.  We also have feed reading down in Node, and lots of tools, etc. So it's a good time to try to create some community glue. ;-)

### Open source

The database software is open source so if other communities want to run their own feedBases, you're welcome to. It requires a MySQL database and a  bit of configuration.

### Open formats and protocols

RSS and OPML are a strong foundation, widely supported. And as they say, really simple. 

### Other docs

1. <a href="https://github.com/scripting/feedbase/blob/master/docs/groundrules.md">Groundrules</a> -- what you need to know about privacy and how feedBase works.

1. <a href="https://github.com/scripting/feedbase/blob/master/docs/database.md">Database structure</a> -- docs for the <i>feeds</i> and <i>subscriptions</i> tables.  

