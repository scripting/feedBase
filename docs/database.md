## Database structure for feedBase

There are three tables, <i>feeds,</i>  <i>subscriptions</i> and <i>log</i>.

### feeds

Each element in the <i>feeds</i> table represents one feed. 

1. feedUrl -- the URL of the feed. This is the key field. 

2. title -- comes from the top-level &lt;title> element of the feed. 

3. htmlUrl -- links to the HTML page corresponding to the feed, comes from the top-level &lt;link> element in the feed. 

4. description -- comes from the top-level &lt;description> element of the feed.

11. ctChecks -- the number of times the feed has been read. We read each feed periodically, the update the information we maintain about it. 

5. whenUpdated -- the last time the feed was read.

8. code -- the HTTP code returned the last time the feed was read. 200 means it was read without error. 

7. ctSecs -- how long it took to read the feed, the last time it was read. 

9. ctErrors -- the number of times there was an error reading the feed. 

10. ctConsecutiveErrors -- the number of consecutive errors. 

12. whenLastError -- the last time there was an error reading the feed. 

6. countSubs -- the number of subscribers. 

### subscriptions

Each element in the <i>subscriptions</i> table represents one subscription. 

1. username -- the Twitter ID of the user whose subscription this is. 

4. feedUrl -- the URL of the feed that the user is subscribed to. 

3. whenUpdated -- when the subscription was last updated.

2. listname -- the list that the subscription came from (now it's always subs.opml, in the future we may support more than one list per user).

### log

Each element in the <i>log</i> table represents a log entry. 

1. username -- the Twitter ID of the user who initiated the event. 

4. feedUrl -- the URL of the feed that the event relates to. 

3. whenadd -- when the event was last added

2. what -- indicates what happened, for example, subscribe, unsubscribe or new feed.

### SQL commands to create the tables

```SQL

create table feeds (

      feedUrl varchar (512), 

      title varchar (255), 

      htmlUrl varchar (512), 

      description varchar (512), 

      whenUpdated datetime, 

      countSubs int, 

      ctSecs float, 

      code int, 

      ctErrors int default 0, 

      ctConsecutiveErrors int default 0, 

      ctChecks int default 0, 

      whenLastError datetime, 

      primary key (feedUrl)

      );

create table subscriptions (

      username varchar (255), 

      listname varchar (255), 

      feedUrl varchar (512), 

      whenupdated datetime, 

      PRIMARY KEY (feedUrl, username)

      );

create table log (

      username varchar (255), 

      feedUrl varchar (512), 

      whenadd datetime, 

      what varchar (255), 

      PRIMARY KEY (whenadd, username)

      );

```

