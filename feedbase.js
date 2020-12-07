var myProductName = "feedBase", myVersion = "0.7.1"; 

/*  The MIT License (MIT) 
	Copyright (c) 2014-2018 Dave Winer
	
	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:
	
	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.
	
	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
	*/

const mysql = require ("mysql");
const davesql = require ("davesql");
const utils = require ("daveutils");
const fs = require ("fs");
const request = require ("request");
const opml = require ("daveopml");
const dateFormat = require ("dateformat");
const s3 = require ("daves3"); 
const davehttp = require ("davehttp"); 
const davetwitter = require ("davetwitter");
const feedParser = require ("feedparser");
const crypto = require ("crypto");
const feedRead = require ("davefeedread"); //3/31/18 by DW

var config = {
	flFeedUpdates: true, //if false we don't check feeds for changed info, useful for test servers -- 4/7/18 by DW
	ctSecsBetwFeedUpdates: 15,
	minSecsBetwSingleFeedUpdate: 60 * 15, //at least 15 minutes betw checks for each feed
	outlineImportFolder: "outlines/",
	usersFolder: "users/",
	fnamePrefs: "prefs.json", //each user's prefs file
	fnameOpml: "subs.opml",
	fnameLastUploadedOpml: "lastUploaded.opml", 
	fnameS3backup: "s3Backup.opml",
	fnameStats: "data/stats.json", //stats for the app
	fnameLog: "data/log.json", 
	logsFolder: "data/logs/",
	savedFeedInfoFolder: "data/feeds/",
	fnameFeedInfo: "feedInfo.json",
	
	opmlS3path: "/opml.feedbase.io/", //2/28/18 by DW -- where we save each users' OPML file
	opmlS3url: "http://opml.feedbase.io/",
	
	requestTimeoutSecs: 3,
	homepage: {
		pagetitle: "feedBase",
		urlTwitterServer: "http://feedbase.io/"
		},
	urlFavicon: "http://scripting.com/favicon.ico",
	urlServerHomePageSource: "http://scripting.com/code/feedbase/index.html",
	ctSecsHomepageCache: 1, //set it higher for stable production server
	
	whenHotlistCreated: new Date ("Fri, 09 Mar 2018 17:46:45 GMT"),
	hotlistTitle: "feedBase hotlist in OPML",
	s3HotlistPath: "hotlist.opml",
	
	ctHotlistItems: 150, //4/2/18 by DW
	
	maxLengthFeedDescription: 512, //4/5/18 by DW
	maxLengthFeedTitle: 255, //4/5/18 by DW
	backupFolder: "data/backups/", //11/27/19 by DW
	
	duplicateUrlMap: { //4/8/18 by DW
		"http://www.scripting.com/rss.xml": "http://scripting.com/rss.xml",
		
		"http://ranchero.com/xml/rss.xml": "http://inessential.com/xml/rss.xml",
		
		"https://daringfireball.net/feeds/main": "http://daringfireball.net/feeds/main",
		"http://daringfireball.net/index.xml": "http://daringfireball.net/feeds/main",
		"http://daringfireball.net/feeds/main": "http://daringfireball.net/feeds/main",
		
		"http://feeds.feedburner.com/codinghorror": "http://feeds.feedburner.com/codinghorror/",
		
		"http://xkcd.com/atom.xml": "http://xkcd.com/rss.xml",
		"https://xkcd.com/rss.xml": "http://xkcd.com/rss.xml",
		
		"http://www.randsinrepose.com/index.xml": "http://randsinrepose.com/feed/",
		
		"http://www.marco.org/rss": "http://marco.org/rss",
		
		"http://scobleizer.com/feed/": "http://scobleizer.blog/feed/",
		
		"http://www.joelonsoftware.com/rss.xml": "https://www.joelonsoftware.com/feed/"
		}
	};
const fnameConfig = "config.json";

var stats = {
	productName: myProductName,
	version: myVersion,
	
	ctStartups: 0,
	whenLastStartup: new Date (),
	ctHits: 0,
	ctHitsToday: 0,
	ctHitsThisRun: 0,
	whenLastHit: new Date (),
	
	ctFeedUpdates: 0,
	ctFeedUpdatesToday: 0,
	ctFeedUpdatesThisRun: 0,
	whenLastFeedUpdate: new Date (),
	whenLastDayRollover: new Date (),
	whenLastHotlistChange: new Date (), 
	whenLastLogChange: new Date (), 
	
	ctSubscriptions: undefined, //4/1/18 by DW
	ctFeeds: undefined, //4/1/18 by DW
	
	lastFeedUpdate: {
		}
	};
var flStatsChanged = false;

var theSqlConnectionPool = undefined; 
var flOneConsoleMsgInLastMinute = false;
var whenLastHomepageRead = new Date (0), homepageCache = undefined;
var flHotlistChanged = false;


function hashMD5 (s) {
	return (crypto.createHash ("md5").update (s).digest ("hex"));
	}
function popProtocol (url) { //remove "http" from the beginning of http://xxx.yyy
	var protocol = utils.stringNthField (url, ":", 1);
	return (utils.stringDelete (url, 1, protocol.length));
	}
function derefUrl (url, callback) {
	var theRequest = {
		method: "HEAD", 
		url: url, 
		followAllRedirects: true,
		maxRedirects: 5
		};
	request (theRequest, function (err, response) {
		if (err) {
			callback (err);
			}
		else {
			var newUrl = response.request.href;
			if (popProtocol (newUrl) == popProtocol (url)) {
				newUrl = url;
				}
			callback (undefined, newUrl);
			}
		});
	}
function isFolder (f) {
	return (fs.lstatSync (f).isDirectory ());
	}
function statsChanged () {
	flStatsChanged = true;
	}
function hotlistChanged () {
	flHotlistChanged = true; //3/22/18 by DW
	stats.whenLastHotlistChange = new Date (); //3/16/18 by DW
	statsChanged ();
	}
function processHomepageText (s) { //2/1/18 by DW
	var pagetable = new Object (), pagetext;
	utils.copyScalars (config.homepage, pagetable);
	pagetable.productName = myProductName;
	pagetable.version = myVersion;
	pagetable.configJson = utils.jsonStringify (pagetable);
	pagetext = utils.multipleReplaceAll (s, pagetable, false, "[%", "%]");
	return (pagetext);
	}
function formatDateTime (when) {
	if (when === undefined) {
		when = new Date ();
		}
	return (dateFormat (new Date (when), "yyyy-mm-dd HH:MM:ss"));
	}
function resetFeedSubCount (feedUrl, callback) { //set the ctSubs column for the indicated feed in the feeds table
	var sqltext = "SELECT count(*) AS c FROM subscriptions WHERE feedUrl=" + davesql.encode (feedUrl);
	davesql.runSqltext (sqltext, function (err, resultCount) {
		var firstLine = resultCount [0];
		sqltext = "UPDATE feeds SET countSubs = " + firstLine.c + " WHERE feedUrl = " + davesql.encode (feedUrl);
		davesql.runSqltext (sqltext, function (err, resultUpdate) {
			if (callback !== undefined) {
				callback (resultUpdate);
				}
			});
		});
	}
function addSubscriptionToDatabase (username, listname, feedurl, callback) {
	var now = formatDateTime (new Date ());
	var sqltext = "REPLACE INTO subscriptions (username, feedUrl, whenUpdated) VALUES (" + davesql.encode (username) + ", " + davesql.encode (feedurl) + ", " + davesql.encode (now) + ");";
	hotlistChanged ();
	davesql.runSqltext (sqltext, function (err, result) {
		resetFeedSubCount (feedurl, function (resetResult) {
			if (callback !== undefined) {
				callback (result);
				}
			});
		});
	}

//the log
	
	var theLog = {
		whenLastSave: new Date (),
		whenLastRollover: new Date (),
		ctSaves: 0,
		logArray: new Array ()
		};
		
	var flLogChanged = false;
	
	function addToLog (username, what, feedUrl, callback) {
		console.log ("addToLog: username == " + username + ", what == " + what + ", feedUrl == " + feedUrl);
		theLog.logArray.unshift ({
			username: username,
			what: what,
			feedUrl: feedUrl,
			when: new Date ()
			});
		flLogChanged = true;
		stats.whenLastLogChange = new Date (); //3/28/18 by DW
		statsChanged ();
		}
	function writeLogIfChanged (callback) {
		if (flLogChanged) {
			flLogChanged = false;
			theLog.whenLastSave = new Date ();
			theLog.ctSaves++;
			utils.sureFilePath (config.fnameLog, function () {
				var jsontext = utils.jsonStringify (theLog);
				fs.writeFile (config.fnameLog, jsontext, function (err) {
					var f = config.logsFolder + utils.getDatePath (undefined, false) + ".json";
					utils.sureFilePath (f, function () {
						fs.writeFile (f, jsontext, function (err) {
							});
						});
					});
				});
			}
		}
	function readCurrentLogFile (callback) {
		fs.readFile (config.fnameLog, function (err, jsontext) {
			if (!err) {
				var jstruct = JSON.parse (jsontext);
				for (var x in jstruct) {
					theLog [x] = jstruct [x];
					}
				}
			if (callback !== undefined) {
				callback ();
				}
			});
		}
	
	
//nightly backup -- 11/26/19 AM by DW
	function backupSubscriptions (callback) {
		var sqltext = "select * from subscriptions;";
		davesql.runSqltext (sqltext, function (err, result) {
			var subs = new Array ();
			for (var i = 0; i < result.length; i++) {
				subs.push (result [i]);
				}
			callback (subs);
			});
		}
	function backupFeeds (callback) {
		var sqltext = "select * from feeds;";
		davesql.runSqltext (sqltext, function (err, result) {
			var feeds = new Array ();
			for (var i = 0; i < result.length; i++) {
				feeds.push (result [i]);
				}
			callback (feeds);
			});
		}
	function writeBackupFile (theData, fname, callback) {
		var f = config.backupFolder + fname;
		utils.sureFilePath (f, function () {
			var jsontext = utils.jsonStringify (theData);
			fs.writeFile (f, jsontext, function (err) {
				if (err) {
					console.log ("writeBackupFile: f == " + f + ", err.message == " + err.message);
					}
				else {
					console.log ("writeBackupFile: f == " + f);
					}
				if (callback !== undefined) {
					callback ();
					} 
				});
			});
		}
	function doBackup () {
		var whenstart = new Date ();
		backupFeeds (function (theFeeds) {
			console.log ("doBackup: theFeeds.length == " + theFeeds.length);
			writeBackupFile (theFeeds, "feeds.json", function () {
				theFeeds = []; //reclaim memory used by the array
				backupSubscriptions (function (theSubs) {
					console.log ("doBackup: theSubs.length == " + theSubs.length);
					writeBackupFile (theSubs, "subscriptions.json", function () {
						console.log ("doBackup: backup took " + utils.secondsSince (whenstart) + " secs.");
						});
					});
				});
			});
		}

function addFeedToDatabase (feedUrl, callback) {
	var whenstart = new Date ();
	getFeedInfoFromDatabase (feedUrl, function (err, values) {
		var flFeedWasInDatabase = false;
		if (err) {
			values = {
				feedUrl: feedUrl,
				ctChecks: 0,
				ctErrors: 0,
				ctConsecutiveErrors: 0
				};
			}
		else {
			flFeedWasInDatabase = true;
			}
		getFeedInfo (feedUrl, function (info, httpResponse) { //gets the info from the feed, on the net
			if (true) { //(flFeedWasInDatabase || (httpResponse.statusCode == 200)) {
				values.code = httpResponse.statusCode;
				values.whenUpdated = formatDateTime (whenstart);
				values.ctSecs = utils.secondsSince (whenstart);
				if (values.ctsecs !== undefined) {
					delete values.ctsecs;
					}
				values.ctChecks++;
				
				function updateRecord (values, callback) {
					var sqltext = "replace into feeds " + davesql.encodeValues (values);
					stats.lastFeedUpdate = values;
					davesql.runSqltext (sqltext, function (err, result) {
						resetFeedSubCount (feedUrl, function () {
							if (callback !== undefined) {
								callback (values);
								}
							});
						});
					}
				if (info !== undefined) {
					values.title = utils.maxStringLength (info.title, config.maxLengthFeedTitle, true, true); 
					values.htmlUrl = info.htmlUrl;
					values.description = utils.maxStringLength (info.description, config.maxLengthFeedDescription, true, true); 
					values.ctConsecutiveErrors = 0;
					}
				else {
					values.ctErrors++;
					values.ctConsecutiveErrors++;
					values.whenLastError = values.whenUpdated;
					}
				updateRecord (values, callback); 
				}
			else {
				callback ();
				}
			});
		});
	}
function adjustHotlistCounts (theList) {
	var addCounts = new Object ();
	for (var i = theList.length - 1; i >= 0; i--) {
		var item = theList [i], realUrl = config.duplicateUrlMap [item.feedUrl];
		if (realUrl !== undefined) {
			addCounts [realUrl] = item.countSubs;
			theList.splice (i, 1);
			}
		}
	for (var i = 0; i < theList.length; i++) { //4/8/18 by DW
		var item = theList [i];
		if (addCounts [item.feedUrl] !== undefined) {
			item.countSubs += addCounts [item.feedUrl];
			}
		}
	}
function getHotlist (callback) {
	const sqltext = "SELECT subscriptions.feedUrl, feeds.title, feeds.htmlUrl, COUNT(subscriptions.feedUrl) AS countSubs FROM subscriptions, feeds WHERE subscriptions.feedUrl = feeds.feedUrl and feeds.title is not null GROUP BY feedUrl ORDER BY countSubs DESC LIMIT " + config.ctHotlistItems + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		adjustHotlistCounts (result); //4/8/18 by DW
		callback (result);
		});
	}
function updateHotlist (whenClientLastUpdate, callback) { //3/16/18 by DW
	var whenClient = new Date (whenClientLastUpdate);
	var whenServer = new Date (stats.whenLastHotlistChange);
	if (whenServer > whenClient) {
		getHotlist (function (theHotlist) {
			var returnData = {
				hotlist: theHotlist,
				when: stats.whenLastHotlistChange
				};
				
			callback (returnData);
			});
		}
	else {
		var returnData = {
			when: stats.whenLastHotlistChange
			};
			
		callback (returnData);
		}
	}
function updateLog (whenClientLastUpdate, callback) { //3/28/18 by DW
	var whenClient = new Date (whenClientLastUpdate);
	var whenServer = new Date (stats.whenLastLogChange);
	var returnData = {
		when: stats.whenLastLogChange
		};
	if (whenServer > whenClient) {
		var ct = 100;
		if (theLog.logArray.length < ct) {
			ct = theLog.logArray.length;
			}
		returnData.log = new Array ();
		for (var i = 0; i < ct; i++) {
			returnData.log.push (theLog.logArray [i]);
			}
		}
	callback (returnData);
	}
function getKnownFeeds (callback) {
	var sqltext = "select feedUrl from feeds where code = 200;";
	davesql.runSqltext (sqltext, function (err, result) {
		var feeds = new Array ();
		for (var i = 0; i < result.length; i++) {
			feeds.push (result [i].feedUrl);
			}
		callback (feeds);
		});
	}
function getInfoAboutKnownFeeds (callback) {
	getKnownFeeds (function (theFeeds) {
		function doNextFeed (ix) {
			if (ix < theFeeds.length) {
				addFeedToDatabase (theFeeds [ix], function () {
					doNextFeed (ix + 1);
					});
				}
			else {
				callback ();
				}
			}
		doNextFeed (0);
		});
	}
function deleteSubscriptions (username, callback) {
	var sqltext = "delete from subscriptions where username = " + davesql.encode (username) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		callback (result);
		});
	}
function getUserSubscriptions (username, callback) {
	var sqltext = "SELECT s.feedUrl, f.title, f.htmlUrl, f.countSubs, f.ctChecks, f.whenUpdated, f.code, f.ctSecs, f.ctErrors, f.ctConsecutiveErrors, f.whenLastError, s.categories FROM subscriptions AS s, feeds AS f WHERE s.feedUrl = f.feedUrl AND f.title is not null AND s.username = " + davesql.encode (username) + " ORDER BY s.whenUpdated DESC;";
	davesql.runSqltext (sqltext, function (err, result) {
		result.forEach (function (sub) {
			if (sub.categories == null) {
				delete sub.categories;
				}
			});
		callback (result);
		});
	}
function getOpmlFromArray (metadata, feedsArray) {
	var opmltext = "", indentlevel = 0, now = new Date ();
	function add (s) {
		opmltext += utils.filledString ("\t", indentlevel) + s + "\n";
		}
	function encode (s) {
		if ((s === undefined) || (s === null)) {
			return ("");
			}
		return (utils.encodeXml (s));
		}
	add ("<?xml version=\"1.0\"?>");
	add ("<!-- OPML generated by " + myProductName + " v" + myVersion + " on " + now.toUTCString () + " -->");
	add ("<opml version=\"2.0\">"); indentlevel++;
	//add head
		add ("<head>"); indentlevel++;
		
		if (metadata.dateCreated !== undefined) {
			metadata.dateCreated = new Date (metadata.dateCreated).toUTCString ();
			}
		for (var x in metadata) {
			if (x !== "name") {
				var s = metadata [x];
				if (s.length > 0) {
					add ("<" + x + ">" + encode (s) + "</" + x + ">");
					}
				}
			}
		
		add ("<dateModified>" + now.toUTCString () + "</dateModified>");
		add ("</head>"); indentlevel--;
	add ("<body>"); indentlevel++;
	//add the <outline> elements
		function att (name, val) {
			if ((val === undefined) || (val === null)) {
				return ("");
				}
			else {
				return (" " + name + "=\"" + utils.encodeXml (val) + "\"");
				}
			}
		function addOneSub (theSub) {
			//there are two possible kinds of nodes here, we handle both -- 5/14/18 by DW
			if (theSub.feedUrl !== undefined) {
				add ("<outline type=\"rss\"" + att ("text", theSub.title) + att ("xmlUrl", theSub.feedUrl) + att ("htmlUrl", theSub.htmlUrl) +  " />");
				}
			else {
				add ("<outline type=\"rss\"" + att ("text", theSub.title) + att ("xmlUrl", theSub.xmlurl) + att ("htmlUrl", theSub.htmlurl) +  " />");
				}
			}
		function addSubs (subs) {
			for (var i = 0; i < subs.length; i++) {
				var feed = subs [i];
				if (feed.subs !== undefined) {
					add ("<outline" + att ("text", feed.text) + ">"); indentlevel++;
					addSubs (feed.subs);
					add ("</outline>"); indentlevel--;
					}
				else {
					addOneSub (feed);
					}
				}
			}
		addSubs (feedsArray);
	add ("</body>"); indentlevel--;
	add ("</opml>"); indentlevel--;
	return (opmltext);
	}
function getUserOpmlSubscriptions (username, catname, callback) {
	function findCat (theCats, catname) {
		var theCat = undefined;
		if (catname !== undefined) {
			console.log ("findCat: theCats == " + utils.jsonStringify (theCats) + ", catname == " + catname);
			theCats.forEach (function (item) {
				if (item.name.toLowerCase () == catname.toLowerCase ()) {
					theCat = item;
					}
				});
			}
		return (theCat);
		}
	console.log ("getUserOpmlSubscriptions: username == " + username + ", catname == " + catname);
	getPrefs (username, function (err, jstruct) {
		var now = new Date (), whenCreated;
		try {
			whenCreated = jstruct.prefs.whenFirstStartup;
			}
		catch (err) {
			whenCreated = now;
			}
		getUserSubscriptions (username, function (feedsArray) {
			var thisCatsFeeds;
			if (catname === undefined) {
				thisCatsFeeds = feedsArray;
				}
			else {
				thisCatsFeeds = new Array ();
				feedsArray.forEach (function (theFeed) {
					if (theFeed.categories !== undefined) {
						var splits = theFeed.categories.split (",");
						splits.forEach (function (s) {
							if (s.toLowerCase () == catname.toLowerCase ()) {
								thisCatsFeeds.push (theFeed);
								}
							});
						}
					});
				}
			var title;
			if (catname === undefined) {
				title = "Subscriptions for " + username;
				}
			else {
				title = username + ": " + catname + " feeds.";
				}
			var description = "";
			var metadata = {
				title,
				description,
				dateCreated: whenCreated
				};
			if (jstruct.prefs.categories !== undefined) { //12/6/20 by DW
				var thisCategory = findCat (jstruct.prefs.categories, catname);
				if (thisCategory !== undefined) {
					for (var x in thisCategory) {
						metadata [x] = thisCategory [x];
						}
					}
				}
			var opmltext = getOpmlFromArray (metadata, thisCatsFeeds);
			callback (undefined, opmltext);
			});
		});
	}
function getUserOpmlUrl (username, catname) {
	var fname = "main.opml";
	if (catname !== undefined) {
		fname = utils.innerCaseName (catname) + ".opml";
		}
	return (config.opmlS3url + username + "/" + fname);
	}
function getUserRecommendations (username, callback) { //3/30/19 by DW
	var sqltext = "select distinct f1.countSubs, f1.title, f1.feedUrl, f1.htmlUrl from subscriptions s1,  subscriptions s2, subscriptions s3, feeds f1 where s1.feedUrl = s2.feedUrl and s1.username = " + davesql.encode (username) + " and s1.username != s2.username and s2.username = s3.username and s3.feedUrl = f1.feedUrl and s3.feedUrl not in (select feedUrl from subscriptions where username = "  + davesql.encode (username) + ") order by f1.countSubs DESC, f1.title limit 20;";
	console.log ("getUserRecommendations: sqltext == " + sqltext);
	davesql.runSqltext (sqltext, function (err, result) {
		callback (undefined, result);
		});
	}
function uploadUserOpmlToS3 (username, callback) { //2/28/18 by DW
	getPrefs (username, function (err, jstruct) {
		var theCategories = jstruct.prefs.categories;
		console.log ("uploadUserOpmlToS3: theCategories == " + utils.jsonStringify (theCategories));
		function uploadOne (theCategory, callback) {
			var catname, fname;
			if (theCategory === undefined) {
				catname = undefined;
				fname = "main.opml";
				}
			else {
				catname = theCategory.name;
				fname = utils.innerCaseName (catname) + ".opml";
				}
			getUserOpmlSubscriptions (username, catname, function (err, opmltext) {
				if (err) {
					callback (err);
					}
				else {
					var path = config.opmlS3path + username + "/" + fname;
					s3.newObject (path, opmltext, "text/xml", "public-read", function (err, data) {
						console.log ("uploadUserOpmlToS3: url == http:/" + path);
						var f = config.usersFolder + username + "/" + fname; //3/13/18 by DW
						utils.sureFilePath (f, function () {
							fs.writeFile (f, opmltext, function (err) {
								});
							});
						callback (undefined, getUserOpmlUrl (username, catname));
						});
					}
				});
			}
		uploadOne (undefined, function (err, opmlUrl) { //upload the main file
			if (err) {
				callback (err);
				}
			else {
				if (theCategories === undefined) { //this user has no categories
					callback (undefined, {opmlUrl});
					}
				else {
					var ix = 0, arrayOfUrls = [opmlUrl];
					function uploadNext (ix) {
						if (ix < theCategories.length) {
							uploadOne (theCategories [ix], function (err, opmlUrl) { //upload the opml file for the category
								if (!err) {
									arrayOfUrls.push (opmlUrl);
									}
								uploadNext (ix + 1);
								});
							}
						else {
							callback (undefined, arrayOfUrls);
							}
						}
					uploadNext (0);
					}
				}
			});
		});
	}
function uploadHotlistToS3 (callback) { //3/22/18 by DW
	getHotlist (function (theHotlist) {
		var metadata = {
			title: config.hotlistTitle,
			description: undefined,
			dateCreated: config.whenHotlistCreated
			};
		var opmltext = getOpmlFromArray (metadata, theHotlist);
		var path = config.opmlS3path + config.s3HotlistPath;
		s3.newObject (path, opmltext, "text/xml", "public-read", function (err, data) {
			callback ();
			});
		});
	}
function getFeedInfoFromDatabase (feedUrl, callback) { //as opposed to getting it from the feed itself
	var sqltext = "SELECT * FROM feeds WHERE feedUrl=" + davesql.encode (feedUrl) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		if (result.length == 0) {
			callback ({message: "Can't get the info for the feed \"" + feedUrl + "\" because it is not in the database."});
			}
		else {
			callback (undefined, result [0]);
			}
		});
	}
function getUsersWhoFollowFeed (feedUrl, callback) {
	var sqltext = "select username from subscriptions where feedUrl=" + davesql.encode (feedUrl) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		var userarray = new Array ();
		if (result !== undefined) { //4/17/18 by DW
			for (var i = 0; i < result.length; i++) {
				userarray.push (result [i].username);
				}
			}
		callback (userarray);
		});
	}
function updateOneFeed (feedUrl, callback) {
	addFeedToDatabase (feedUrl, function (addResult) {
		saveFeedInfoJson (feedUrl, function () {
			if (callback !== undefined) {
				callback (addResult);
				}
			});
		});
	}
function updateLeastRecentlyUpdatedFeed (callback) {
	var sqltext = "SELECT * FROM feeds ORDER BY whenUpdated ASC LIMIT 1;";
	davesql.runSqltext (sqltext, function (err, result) {
		if (result.length > 0) { //3/7/18 by DW
			var theFeed = result [0];
			var secsSinceUpdate = utils.secondsSince (theFeed.whenUpdated);
			if (secsSinceUpdate >= config.minSecsBetwSingleFeedUpdate) {
				updateOneFeed (theFeed.feedUrl, callback);
				}
			}
		});
	}
function updateThisFeed (feedUrl, callback) { //handle a ping call
	getFeedInfoFromDatabase (feedUrl, function (err, info) {
		if (err) { //4/2/18 by DW
			if (callback !== undefined) {
				callback (err.message);
				}
			}
		else {
			if (info.feedUrl !== undefined) { //it's one of our feeds
				addFeedToDatabase (feedUrl, function (addResult) {
					if (callback !== undefined) {
						callback (info);
						}
					});
				}
			else {
				if (callback !== undefined) {
					callback (info);
					}
				}
			}
		});
	}
function resetAllSubCounts (callback) {
	getKnownFeeds (function (theFeeds) {
		function doNextFeed (ix) {
			if (ix < theFeeds.length) {
				resetFeedSubCount (theFeeds [ix], function () {
					doNextFeed (ix + 1);
					});
				}
			else {
				if (callback !== undefined) {
					callback ();
					}
				}
			}
		doNextFeed (0);
		});
	}
function getFeedInfo (feedUrl, callback) {
	feedRead.parseUrl (feedUrl, config.requestTimeoutSecs, function (err, theFeed, httpResponse) {
		
		if (httpResponse === undefined) {
			console.log ("getFeedInfo: httpResponse is undefined, feedUrl == " + feedUrl);
			httpResponse = { //should not be needed
				statusCode: 400
				}
			}
		
		if (err) {
			callback (undefined, httpResponse);
			}
		else {
			var info = {
				title: theFeed.head.title,
				htmlUrl: theFeed.head.link,
				description: theFeed.head.description
				}
			callback (info, httpResponse);
			}
		});
	}
function readFeedIncludeEverything (feedUrl, callback) { 
	feedRead.parseUrl (feedUrl, config.requestTimeoutSecs, function (err, theFeed, httpResponse) {
		if (err) {
			callback (undefined, httpResponse);
			}
		else {
			function ifNotNull (val) {
				if (val === null) {
					return (undefined);
					}
				else {
					return (val);
					}
				}
			var returnedFeed = {
				head: theFeed.head,
				items: []
				};
			theFeed.items.forEach (function (item) {
				var returnedItem = {
					title: ifNotNull (item.title),
					link: ifNotNull (item.link),
					description: ifNotNull (item.description),
					pubDate: ifNotNull (item.pubDate),
					guid: ifNotNull (item.guid),
					author: ifNotNull (item.author),
					permalink: ifNotNull (item.permalink)
					};
				if (item.enclosures.length > 0) {
					returnedItem.enclosure = item.enclosures [0];
					}
				if (item.categories.length > 0) {
					returnedItem.categories = item.categories;
					}
				returnedFeed.items.push (returnedItem);
				});
			callback (undefined, returnedFeed);
			}
		});
	}
function saveFeedInfoJson (feedUrl, callback) {
	getFeedInfoFromDatabase (feedUrl, function (err, feedInfo) {
		var f = config.savedFeedInfoFolder + hashMD5 (feedUrl) + "/" + config.fnameFeedInfo;
		utils.sureFilePath (f, function () {
			fs.writeFile (f, utils.jsonStringify (feedInfo), function (err) {
				if (callback !== undefined) {
					callback ();
					}
				});
			});
		});
	}
function readOpmlSubscriptionList (f, flExpandIncludes, callback) { //read OPML file, parse, call back with a list of feeds contained in the file
	opml.readOpmlFile (f, function (theOutline) {
		if (theOutline !== undefined) {
			var feedlist = new Array ();
			function getFeeds (theOutline) {
				if (theOutline.subs !== undefined) {
					for (var i = 0; i < theOutline.subs.length; i++) {
						var node = theOutline.subs [i];
						if (node.xmlurl !== undefined) {
							feedlist.push (node.xmlurl);
							}
						else {
							getFeeds (node);
							}
						}
					}
				}
			getFeeds (theOutline);
			callback (feedlist);
			}
		else {
			callback (undefined);
			}
		}, flExpandIncludes);
	}
function processListOfLists (screenname, opmltext, callback) { //5/14/18 by DW
	const flExpandIncludes = false;
	function saveFile (fname, subs, callback) {
		var metadata = {
			title: fname
			};
		var opmltext = getOpmlFromArray (metadata, subs);
		var path = config.opmlS3path + screenname + "/" + fname;
		s3.newObject (path, opmltext, "text/xml", "public-read", function (err, data) {
			console.log ("processListOfLists: url == http:/" + path);
			var f = config.usersFolder + screenname + "/" + fname; 
			utils.sureFilePath (f, function () {
				fs.writeFile (f, opmltext, function (err) {
					if (callback !== undefined) {
						callback ();
						}
					});
				});
			});
		}
	opml.readOpmlString (opmltext, function (theOutline) {
		var filelist = new Array ();
		if (theOutline !== undefined) {
			if (theOutline.subs !== undefined) {
				for (var i = 0; i < theOutline.subs.length; i++) {
					var node = theOutline.subs [i];
					if (node.xmlurl === undefined) { //it's not a subscription
						if (utils.endsWith (node.text, ".opml")) {
							filelist.push (node.text);
							saveFile (node.text, node.subs);
							}
						}
					}
				}
			callback (undefined, filelist);
			}
		else {
			callback ({message: "Error processing the OPML text."});
			}
		}, flExpandIncludes);
	}
function subscribeToFeed (screenname, fname, feedUrl, callback) {
	getFeedInfoFromDatabase (feedUrl, function (err, info) {
		if (err) {  //not in database
			derefUrl (feedUrl, function (err, newUrl) { 
				if (!err) {
					feedUrl = newUrl;
					}
				console.log ("subscribeToFeed: newUrl == " + newUrl);
				getFeedInfoFromDatabase (feedUrl, function (err, info) {
					if (err) { //not in database
						addFeedToDatabase (feedUrl, function (addResult) {
							addToLog (screenname, "new feed", feedUrl);
							addSubscriptionToDatabase (screenname, undefined, feedUrl, function (result) {
								callback (result);
								});
							});
						}
					else {
						addSubscriptionToDatabase (screenname, undefined, feedUrl, function (result) {
							callback (result);
							});
						}
					});
				});
			}
		else {
			addSubscriptionToDatabase (screenname, undefined, feedUrl, function (result) {
				callback (result);
				});
			}
		});
	}
function processOpmlFile (f, screenname, callback) { //what we do when the user submits an OPML file
	readOpmlSubscriptionList (f, false, function (feedlist) {
		if (feedlist !== undefined) {
			var fname = utils.stringLastField (f, "/");
			function doNextFeed (ix) {
				if (ix < feedlist.length) {
					var feedUrl = feedlist [ix];
					subscribeToFeed (screenname, fname, feedUrl, function () {
						doNextFeed (ix + 1);
						});
					}
				else {
					callback (undefined); //no error
					}
				}
			doNextFeed (0);
			}
		else {
			callback ({message: "Can't process the subscription list because it is not a valid OPML file."});
			}
		});
	}
function importUserFolder (username, callback) {
	var userfolder = config.outlineImportFolder + username;
	console.log ("importUserFolder: username == " + username);
	if (isFolder (userfolder)) {
		console.log (userfolder);
		fs.readdir (userfolder, function (err, filelist) {
			if (err) {
				console.log ("importOpmlFiles: err.message == " + err.message);
				if (callback !== undefined) {
					callback ();
					}
				}
			else {
				function processNextFile (ix) {
					if (ix < filelist.length) {
						var fname = filelist [ix], f = userfolder + "/" + fname;
						console.log ("importUserFolder: f == " + f);
						processOpmlFile (f, username, function () {
							processNextFile (ix + 1);
							});
						}
					else {
						if (callback !== undefined) {
							callback ();
							}
						}
					}
				processNextFile (0);
				}
			});
		}
	}
function importOpmlFiles (callback) { //imports outlines from the previous version of SYO
	fs.readdir (config.outlineImportFolder, function (err, userlist) {
		if (err) {
			console.log ("importOpmlFiles: err.message == " + err.message);
			}
		else {
			for (var i = 0; i < userlist.length; i++) {
				importUserFolder (userlist [i]);
				}
			}
		if (callback !== undefined) {
			callback ();
			}
		});
	}
function logSubscribe (screenname, feedUrl) {
	isSubscribed (screenname, feedUrl, function (flSubscribed) {
		if (!flSubscribed) {
			addToLog (screenname, "subscribe", feedUrl);
			}
		});
	}
function logUnsubscribe (screenname, feedUrl) {
	isSubscribed (screenname, feedUrl, function (flSubscribed) {
		if (flSubscribed) {
			addToLog (screenname, "unsubscribe", feedUrl);
			}
		});
	}
function subscribe (screenname, feedUrl, callback) {
	console.log ("subscribe: screenname == " + screenname + ", feedUrl == " + feedUrl);
	subscribeToFeed (screenname, undefined, feedUrl, function () {
		resetFeedSubCount (feedUrl, function () {
			if (callback !== undefined) {
				callback ();
				}
			});
		});
	}
function unsubscribe (screenname, feedUrl, callback) {
	var sqltext = "delete from subscriptions where username = " + davesql.encode (screenname) + " and feedUrl = " + davesql.encode (feedUrl) + ";";
	hotlistChanged ();
	logUnsubscribe (screenname, feedUrl);
	davesql.runSqltext (sqltext, function (err, result) {
		resetFeedSubCount (feedUrl, function () {
			if (callback !== undefined) {
				callback (result);
				}
			});
		});
	}
function getSubscription (screenname, feedUrl, callback) { //12/4/20 PM by DW -- xxx
	const sqltext = "select * from subscriptions where username = " + davesql.encode (screenname) + " and feedurl = " + davesql.encode (feedUrl) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		var theSubscription;
		if (result.length == 0) {
			theSubscription = new Object (); //empty
			}
		else {
			theSubscription = result [0];
			if (theSubscription.categories == null) {
				delete theSubscription.categories;
				}
			if (theSubscription.listname !== undefined) { //evolving away from this, don't show through the api
				delete theSubscription.listname;
				}
			}
		callback (undefined, theSubscription);
		});
	}
function setCategoriesForSubscription (screenname, feedUrl, catstring, callback) { //12/3/20 PM by DW -- xxx
	const sqltext = "select * from subscriptions where username = " + davesql.encode (screenname) + " and feedurl = " + davesql.encode (feedUrl) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		var theSubscription = result [0];
		if (theSubscription === undefined) {
			callback ({message: "Can't set the categories because the user isn't subscribed to the feed."});
			}
		else {
			theSubscription.categories = catstring;
			const sqltext = "replace into subscriptions " + davesql.encodeValues (theSubscription);
			davesql.runSqltext (sqltext, function (err, result) {
				callback (undefined, theSubscription);
				});
			}
		});
	}
function isSubscribed (screenname, feedUrl, callback) {
	getUserSubscriptions (screenname, function (subs) {
		for (var i = 0; i < subs.length; i++) {
			if (subs [i].feedUrl == feedUrl) {
				callback (true);
				}
			}
		callback (false);
		});
	}
function getInitialOpmlText (title) {
	var s = 
		"<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n<opml version=\"2.0\">\n\t<head>\n\t\t<title>[%title%]</title>\n\t\t<dateCreated>[%created%]</dateCreated>\n\t\t<dateModified>[%created%]</dateModified>\n\t\t</head>\n\t<body>\n\t\t<outline text=\"\" created=\"[%created%]\" />\n\t\t</body>\n\t</opml>";
	var replacetable = {
		title: title,
		created: new Date ().toUTCString ()
		};
	s = utils.multipleReplaceAll (s, replacetable, false, "[%", "%]");
	return (s);
	}
function getUserOpml (screenname, callback) {
	var opmlFile = config.usersFolder + screenname + "/" + config.fnameOpml;
	utils.sureFilePath (opmlFile, function () {
		fs.readFile (opmlFile, function (err, data) {
			var result = {
				};
			if (err) {
				result.opmltext = getInitialOpmlText ("SYO");
				}
			else {
				result.opmltext = data.toString ();
				}
			callback (result);
			});
		});
	}
function saveUserOpml (screenname, opmltext, callback) {
	var opmlFile = config.usersFolder + screenname + "/" + config.fnameOpml;
	utils.sureFilePath (opmlFile, function () {
		fs.writeFile (opmlFile, opmltext, function (err) {
			callback (err, true);
			});
		});
	}
function userUploadedOpml (screenname, opmltext, callback) { //called when the user drag-drops an OPML file -- 4/26/18 by DW
	var opmlFile = config.usersFolder + screenname + "/" + config.fnameLastUploadedOpml;
	utils.sureFilePath (opmlFile, function () {
		fs.writeFile (opmlFile, opmltext, function (err) {
			processOpmlFile (opmlFile, screenname, function (err) {
				callback (err, true);
				});
			});
		});
	}
function getDynamicStats (callback) {
	var sqltext1 = "select count(*) from subscriptions;";
	var sqltext2 = "select count(*) from feeds;";
	davesql.runSqltext (sqltext1, function (err, result1) {
		stats.ctSubscriptions = result1 [0] ["count(*)"];
		davesql.runSqltext (sqltext2, function (err, result2) {
			stats.ctFeeds = result2 [0] ["count(*)"];
			if (callback !== undefined) {
				callback (stats);
				}
			});
		});
	}
function getPrefs (screenname, callback) {
	var myPrefs = {
		screenname: screenname
		};
	var folder = config.usersFolder + screenname + "/";
	var prefsFile = folder + config.fnamePrefs;
	utils.sureFilePath (prefsFile, function () {
		fs.readFile (prefsFile, function (err, data) {
			if (err) {
				myPrefs.prefs = new Object ();
				callback (undefined, myPrefs); //return an empty prefs struct
				}
			else {
				try {
					myPrefs.prefs = JSON.parse (data.toString ());
					callback (undefined, myPrefs);
					}
				catch (err) {
					console.log ("getPrefs: err.message == " + err.message);
					callback (err);
					}
				}
			});
		});
	}
function savePrefs (screenname, jsontext, callback) {
	var prefsFile = config.usersFolder + screenname + "/" + config.fnamePrefs;
	utils.sureFilePath (prefsFile, function () {
		fs.writeFile (prefsFile, jsontext, function (err) {
			callback (err, true);
			});
		});
	}
function handleHttpRequest (theRequest) {
	const params = theRequest.params;
	var token = (theRequest.params.oauth_token !== undefined) ? theRequest.params.oauth_token : undefined;
	var secret = (theRequest.params.oauth_token_secret !== undefined) ? theRequest.params.oauth_token_secret : undefined;
	
	flOneConsoleMsgInLastMinute = true;
	
	stats.ctHits++;
	stats.ctHitsToday++;
	stats.ctHitsThisRun++;
	stats.whenLastHit = new Date ();
	
	function returnPlainText (s) {
		theRequest.httpReturn (200, "text/plain", s.toString ());
		}
	function returnData (jstruct) {
		if (jstruct === undefined) {
			jstruct = {};
			}
		theRequest.httpReturn (200, "application/json", utils.jsonStringify (jstruct));
		}
	function returnHtml (htmltext) {
		theRequest.httpReturn (200, "text/html", htmltext);
		}
	function returnXml (xmltext) {
		theRequest.httpReturn (200, "text/xml", xmltext);
		}
	function returnNotFound () {
		theRequest.httpReturn (404, "text/plain", "Not found.");
		}
	function returnError (jstruct) {
		theRequest.httpReturn (500, "application/json", utils.jsonStringify (jstruct));
		}
	function httpReturn (err, jstruct) {
		if (err) {
			returnError (err);
			}
		else {
			returnData (jstruct);
			}
		}
	function returnRedirect (url, code) {
		if (code === undefined) {
			code = 302;
			}
		theRequest.httpReturn (code, "text/plain", code + " REDIRECT");
		}
		
	function returnFeedInfo (feedUrl) {
		getFeedInfoFromDatabase (feedUrl, function (err, result) {
			console.log ("returnFeedInfo: result == " + utils.jsonStringify (result));
			httpReturn (err, result);
			});
		}
	function getSqlResult (sqltext, callback) {
		theSqlConnectionPool.getConnection (function (err, connection) {
			if (err) {
				httpReturn (err);
				}
			else {
				connection.query (sqltext, function (err, result) {
					connection.release ();
					httpReturn (err, result);
					});
				}
			});
		}
	function returnServerHomePage () { //return true if we handled it
		if (config.urlServerHomePageSource === undefined) {
			return (false);
			}
		if (utils.secondsSince (whenLastHomepageRead) > config.ctSecsHomepageCache) {
			request (config.urlServerHomePageSource, function (error, response, pagetext) {
				if (!error && response.statusCode == 200) {
					homepageCache = processHomepageText (pagetext);
					whenLastHomepageRead = new Date ();
					returnHtml (homepageCache);
					}
				else {
					returnNotFound ();
					}
				});
			}
		else {
			returnHtml (homepageCache);
			}
		return (true);
		}
	function updateUserOpml (screenname) { //code was repeating, factored here
		uploadUserOpmlToS3 (screenname, function (err, result) {
			httpReturn (err, result);
			});
		}
	function callWithScreenname (callback) {
		davetwitter.getScreenName (token, secret, function (screenname) {
			if (screenname === undefined) {
				returnError ({message: "Can't do the thing you want because the accessToken is not valid."});    
				}
			else {
				callback (screenname);
				}
			});
		}
	
	switch (theRequest.lowerpath) {
		case "/":
			return (returnServerHomePage ());
		case "/now": 
			returnPlainText (new Date ());
			return (true); //we handled it
		case "/hotlist":
			getHotlist (function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/updatehotlist": //3/16/18 by DW
			updateHotlist (theRequest.params.when, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/updatelog": //3/28/18 by DW
			updateLog (theRequest.params.when, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/stats":
			getDynamicStats (function (stats) {
				returnData (stats);
				});
			return (true); //we handled it
		case "/getfeedinfo":
			getFeedInfoFromDatabase (theRequest.params.feedurl, function (err, result) {
				httpReturn (err, result);
				});
			return (true); //we handled it
		case "/readfeed": //3/7/18 by DW
			getFeedInfo (theRequest.params.feedurl, function (err, result) {
				httpReturn (err, result);
				});
			return (true); //we handled it
		case "/readfeedincludeeverything": //4/6/19 by DW
			readFeedIncludeEverything (theRequest.params.feedurl, function (err, result) {
				httpReturn (err, result);
				});
			return (true); //we handled it
		case "/ping":
			updateOneFeed (theRequest.params.feedurl, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/deref": //4/19/18 by DW
			derefUrl (theRequest.params.url, function (err, url) {
				httpReturn (err, url);
				});
			return (true); //we handled it
		case "/getfollowers":
			getUsersWhoFollowFeed (theRequest.params.feedurl, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/geterrantfeeds": //3/9/18 by DW
			getSqlResult ("select * from feeds where ctConsecutiveErrors > 0;");
			return (true); //we handled it
		case "/subscribe":
			callWithScreenname (function (screenname) {
				subscribe (screenname, theRequest.params.feedurl, function (result) {
					updateUserOpml (screenname);
					returnFeedInfo (theRequest.params.feedurl);
					});
				});
			return (true); //we handled it
		case "/unsubscribe": //3/10/18 by DW
			callWithScreenname (function (screenname) {
				unsubscribe (screenname, theRequest.params.feedurl, function (result) {
					updateUserOpml (screenname);
					returnFeedInfo (theRequest.params.feedurl);
					});
				});
			return (true); //we handled it
		case "/issubscribed":
			callWithScreenname (function (screenname) {
				isSubscribed (screenname, theRequest.params.feedurl, function (result) {
					returnData (result);
					});
				});
			return (true); //we handled it
		case "/setcategories": //12/3/20 by DW
			callWithScreenname (function (screenname) {
				setCategoriesForSubscription (screenname, params.feedurl, params.catstring, function (err, theSubscription) {
					if (!err) {
						updateUserOpml (screenname);
						}
					httpReturn (err, theSubscription);
					});
				});
			return (true); //we handled it
		case "/updateopml": //12/6/20 by DW
			callWithScreenname (function (screenname) {
				uploadUserOpmlToS3 (screenname, httpReturn);
				});
			return (true); //we handled it
		case "/getsubscription": //12/4/20 by DW
			callWithScreenname (function (screenname) {
				getSubscription (screenname, params.feedurl, httpReturn);
				});
			return (true); //we handled it
		case "/getprefs":
			callWithScreenname (function (screenname) {
				getPrefs (screenname, function (err, result) {
					httpReturn (err, result);
					});
				});
			return (true); //we handled it
		case "/saveprefs":
			callWithScreenname (function (screenname) {
				savePrefs (screenname, theRequest.params.prefs, function (err, result) {
					httpReturn (err, result);
					});
				});
			return (true); //we handled it
		case "/getopml":
			callWithScreenname (function (screenname) {
				getUserOpmlSubscriptions (screenname, undefined, function (err, opmltext) {
					if (err) {
						returnError (err);
						}
					else {
						var result = {
							opmltext: opmltext
							};
						returnData (result);
						}
					});
				});
			return (true); //we handled it
		case "/saveopml":
			callWithScreenname (function (screenname) {
				console.log ("/saveopml: theRequest.postBody.length == " + theRequest.postBody.length);
				userUploadedOpml (screenname, theRequest.postBody, function (err, result) {
					updateUserOpml (screenname);
					});
				});
			return (true); //we handled it
		case "/getsubs":
			getUserSubscriptions (theRequest.params.username, function (subsArray) {
				var jstruct = {
					opmlUrl: getUserOpmlUrl (theRequest.params.username),
					theSubs: subsArray
					};
				returnData (jstruct);
				});
			return (true); //we handled it
		case "/getopmlsubs":
			getUserOpmlSubscriptions (theRequest.params.username, undefined, function (err, opmltext) {
				if (err) {
					returnError (err);
					}
				else {
					returnXml (opmltext);
					}
				});
			return (true); //we handled it
		case "/deleteallsubs": //3/9/18 by DW
			callWithScreenname (function (screenname) {
				deleteSubscriptions (screenname, function (result) {
					updateUserOpml (screenname);
					});
				});
			return (true); //we handled it
		case "/favicon.ico":
			returnRedirect (config.urlFavicon);
			break;
		case "/geteditoropml":
			callWithScreenname (function (screenname) {
				getUserOpml (screenname, function (result) {
					 returnData (result);
					});
				});
			return (true); //we handled it
		case "/saveeditoropml":
			callWithScreenname (function (screenname) {
				var opmltext = theRequest.postBody;
				saveUserOpml (screenname, opmltext, function (err, result) {
					userUploadedOpml (screenname, opmltext, function (err, result) {
						processListOfLists (screenname, opmltext, function (err, filelist) {
							httpReturn (err, result);
							});
						});
					});
				});
			return (true); //we handled it
		case "/getrecommendations": //3/30/19 by DW
			callWithScreenname (function (screenname) {
				console.log ("about to call getUserRecommendations with screenname == " + screenname);
				getUserRecommendations (screenname, function (err, result) {
					httpReturn (err, result);
					});
				});
			return (true); //we handled it
		}
	return (false); //we didn't handle it
	}
function readConfig (callback) {
	utils.sureFilePath (fnameConfig, function () {
		fs.readFile (fnameConfig, function (err, data) {
			if (!err) {
				try {
					var jstruct = JSON.parse (data.toString ());
					for (var x in jstruct) {
						config [x] = jstruct [x];
						}
					}
				catch (err) {
					console.log ("readConfig: err == " + err.message);
					}
				}
			if (callback !== undefined) {
				callback ();
				}
			});
		});
	}
function readStats (callback) {
	utils.sureFilePath (config.fnameStats, function () {
		fs.readFile (config.fnameStats, function (err, data) {
			if (!err) {
				try {
					var jstruct = JSON.parse (data.toString ());
					for (var x in jstruct) {
						stats [x] = jstruct [x];
						}
					}
				catch (err) {
					}
				}
			if (callback !== undefined) {
				callback ();
				}
			});
		});
	}
function writeStats (callback) {
	utils.sureFilePath (config.fnameStats, function () {
		fs.writeFile (config.fnameStats, utils.jsonStringify (stats), function (err) {
			if (callback !== undefined) {
				callback ();
				}
			});
		});
	}
function everyMinute () {
	var now = new Date (), timestring = now.toLocaleTimeString ();
	if (now.getMinutes () == 0) { //12/3/20 by DW
		if (flOneConsoleMsgInLastMinute) {
			console.log ("");
			flOneConsoleMsgInLastMinute = false;
			}
		console.log (myProductName + " v" + myVersion + ": " + timestring + ".\n");
		}
	readConfig ();
	if (!utils.sameDay (stats.whenLastDayRollover, now)) { //date rollover
		stats.whenLastDayRollover = now;
		stats.ctFeedUpdatesToday = 0;
		stats.ctHitsToday = 0;
		statsChanged ();
		doBackup (); //11/26/19 by DW
		}
	if (!utils.sameDay (theLog.whenLastRollover, now)) { //log rollover
		theLog.whenLastRollover = now;
		theLog.logArray = new Array ();
		flLogChanged = true;
		writeLogIfChanged (); 
		}
	if (flHotlistChanged) { //3/22/18 by DW
		uploadHotlistToS3 (function () {
			flHotlistChanged = false;
			});
		}
	}
function everySecond () {
	if (config.flFeedUpdates) {
		if (utils.secondsSince (stats.whenLastFeedUpdate) > config.ctSecsBetwFeedUpdates) {
			stats.whenLastFeedUpdate = new Date ();
			updateLeastRecentlyUpdatedFeed (function () {
				stats.ctFeedUpdates++;
				stats.ctFeedUpdatesToday++;
				stats.ctFeedUpdatesThisRun++;
				statsChanged ();
				});
			}
		}
	if (flStatsChanged) {
		flStatsChanged = false;
		writeStats ();
		}
	writeLogIfChanged (); //3/26/18 by DW
	}
function startup () {
	console.log ("\n" + myProductName + " v" + myVersion + "\n");
	readStats (function () {
		stats.productName = myProductName;
		stats.version = myVersion;
		stats.whenLastStartup = new Date ();
		stats.ctStartups++;
		stats.ctFeedUpdatesThisRun = 0;
		stats.ctHitsThisRun = 0;
		statsChanged ();
		readCurrentLogFile (function () {
			readConfig (function () {
				console.log ("config == " + utils.jsonStringify (config));
				davesql.start (config.database, function () {
					config.twitter.httpRequestCallback = handleHttpRequest;
					config.twitter.flPostEnabled = true; //3/1/18 by DW
					davetwitter.start (config.twitter, function () {
						});
					setInterval (everySecond, 1000); 
					utils.runEveryMinute (everyMinute);
					doBackup (); //11/26/19 by DW
					});
				});
			});
		});
	}
startup ();
