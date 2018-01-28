## What is feedBase?

A project to get lots of feeds into a database.

### How it works

Each user has a single OPML file containing their subscriptions. You can edit the file whenever you like. When your list changes your subscriptions are added to a database of the subscriptions of all other Scripting News readers. We compile a top 100 list so we can see who everyone else subscribes to and find other interesting sites. Periodically we read the feeds to keep our database of info about them up to date. 

### Why?

The blogosphere needs glue. We'll never know how much stuff is going on until we start looking for it. In a sense it's like the first time around, when we put out feelers of different kinds. Some worked others didn't. I remember this approach working really well.

### Why now?

I'm ready to do it, it seems. I did a project late last year to learn how MySQL works in server apps written in Node, and this was a simple evolution of what I had working.  We also have feed reading down in Node, and lots of tools, etc. So it's a good time to try to create some community glue. ;-)

As you see when the code is uploaded, there are a lot of pieces in the feedBase server. Yet it feels like a small piece of code. Lots and lots of factoring. 

### Open source

The database is open source so if other communities want to run their own feedBases, you're welcome to. It requires a MySQL database and a  bit of configuration. I'll write docs for that when it's time to lock things down. 

### Open formats and protocols

RSS and OPML are a strong foundation, widely supported. As they say, really simple. 

### Ideas

There are lots of ideas. I want to write some of them down here. 

