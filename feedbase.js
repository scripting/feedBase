var myVersion = "0.8.0", myProductName = "feedbase";

//big comment -- 12/24/20 by DW
	//This app is built on top of River6 because the data it's maintaining is very similar to the data maintained by R6.
	//There is one difference, where R6 deals in listname's, this app has usernames -- which are Twitter screennames. 
	//To the outside world they are usernames, but internally they are listnames.

const fs = require ("fs");
const request = require ("request");
const dateFormat = require ("dateformat");
const crypto = require ("crypto");
const utils = require ("daveutils");
const feedRead = require ("davefeedread"); 
const davesql = require ("davesql");
const davetwitter = require ("davetwitter");
const s3 = require ("daves3"); 
const opml = require ("daveopml");
const daveappserver = require ("daveappserver"); 
const river6 = require ("river6");

var appOptions = {
	productName: myProductName, 
	productNameForDisplay: "feedBase2",
	version: myVersion,
	urlServerHomePageSource: "http://scripting.com/code/testing/feedbase/index.html",
	flWebsocketEnabled: false,
	everySecond,
	everyMinute,
	httpRequest
	}
var config = {
	flFeedUpdates: false,
	ctSecsBetwFeedUpdates: 10, //10 secs between feed updates
	usersFolder: "data/users/",
	fnamePrefs: "prefs.json", //each user's prefs file
	savedFeedInfoFolder: "data/feeds/",
	fnameStats: "data/stats.json",
	ctHotlistItems: 100,
	opmlS3path: "/opml.feedbase.io/", 
	opmlS3url: "http://opml.feedbase.io/",
	urlRiverViewerPageSource: "http://scripting.com/code/river6/templates/serverhomepage/index.html", //1/4/21 by DW
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
var stats = {
	productName: myProductName,
	version: myVersion,
	
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

function loadFeedsFromTextfile () {
	fs.readFile ("technews.txt", function (err, theText) {
		var theText = theText.toString ();
		var splits = theText.split ("\n");
		splits.forEach (function (feedUrl) {
			console.log (feedUrl);
			if (feedUrl.length > 0) {
				updateOneFeed (feedUrl);
				}
			});
		});
	}

function statsChanged () {
	daveappserver.saveStats (stats);
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
function getUserOpmlUrl (username, catname) {
	var fname = "main.opml";
	if (catname !== undefined) {
		fname = utils.innerCaseName (catname) + ".opml";
		}
	return (config.opmlS3url + username + "/" + fname);
	}
function getUserOpmlList (username, callback) { //12/30/20 by DW
	getPrefs (username, function (err, jstruct) {
		if (err) {
			callback (err);
			}
		else {
			var theCategories = jstruct.prefs.categories, theList = new Array ();
			theCategories.forEach (function (cat) {
				theList.push (getUserOpmlUrl (username, cat.name));
				});
			callback (undefined, theList);
			}
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
				if (s !== undefined) { //12/21/20 AM by DW -- the app actually got this error, go figure
					if (s.length > 0) {
						add ("<" + x + ">" + encode (s) + "</" + x + ">");
						}
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
			if (subs !== undefined) {
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
		getSubscriptions (username, function (err, feedsArray) {
			if (err) {
				callback (err);
				}
			else {
				var thisCatsFeeds;
				console.log ("getUserOpmlSubscriptions: feedsArray == " + utils.jsonStringify (feedsArray));
				if (catname === undefined) {
					thisCatsFeeds = feedsArray;
					}
				else {
					thisCatsFeeds = new Array ();
					if (feedsArray !== undefined) {
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
				}
			});
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
						var f = config.usersFolder + username + "/opml/" + fname; //3/13/18 by DW && 1/6/21 by DW
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
function userUploadedOpml (screenname, opmltext, callback) { //called when the user drag-drops an OPML file -- 4/26/18 by DW
	opml.processOpmlSubscriptionList (opmltext, false, function (theList) {
		if (theList === undefined) {
			callback ({message: "Can't process the OPML because there was an error processing it."});
			}
		else {
			function doNextFeed (ix) {
				if (ix < theList.length) {
					var feedUrl = theList [ix];
					river6.isFeedInDatabase (feedUrl, function (flThere, feedInfo) {
						if (flThere) {
							doNextFeed (ix + 1);
							}
						else {
							river6.readFeed (feedUrl, true, function (err, theFeed) {
								doNextFeed (ix + 1);
								});
							}
						});
					subscribe (screenname, feedUrl);
					}
				else {
					callback (undefined, theList);
					}
				}
			doNextFeed (0);
			}
		});
	}
//utilities to access River6 database -- 12/23/20 by DW -- see big comment at top
	function resetFeedSubCount (feedUrl, callback) { 
		var sqltext = "select count(*) as c from subscriptions where feedUrl=" + davesql.encode (feedUrl);
		davesql.runSqltext (sqltext, function (err, resultCount) {
			var firstLine = resultCount [0];
			sqltext = "update feeds set countSubs = " + firstLine.c + " where feedUrl = " + davesql.encode (feedUrl);
			davesql.runSqltext (sqltext, function (err, resultUpdate) {
				if (callback !== undefined) {
					callback (err, resultUpdate);
					}
				});
			});
		}
	function subscribe (screenname, feedUrl, callback) {
		console.log ("subscribe: screenname == " + screenname + ", feedUrl == " + feedUrl);
		river6.readFeed (feedUrl, true, function (err, theFeed) {
			if (err) {
				if (callback !== undefined) {
					callback (err);
					}
				}
			else {
				var theSubscription = {
					listName: screenname, //12/24/20 by DW
					feedUrl: feedUrl,
					whenUpdated: new Date ()
					};
				var sqltext = "replace into subscriptions " + davesql.encodeValues (theSubscription);
				davesql.runSqltext (sqltext, function (err, result) {
					if (err) {
						if (callback !== undefined) {
							callback (err);
							}
						}
					else {
						resetFeedSubCount (feedUrl);
						if (callback !== undefined) {
							callback (undefined, theFeed);
							}
						}
					});
				}
			});
		}
	function unsubscribe (screenname, feedUrl, callback) {
		var sqltext = "delete from subscriptions where listName = " + davesql.encode (screenname) + " and feedUrl = " + davesql.encode (feedUrl) + ";";
		davesql.runSqltext (sqltext, function (err, result) {
			resetFeedSubCount (feedUrl);
			if (callback !== undefined) {
				callback (err, result);
				}
			});
		}
	function subscribeList (screenname, theList, flSubscribe, callback) {
		var process = (flSubscribe) ? subscribe : unsubscribe;
		function sub (ix) {
			if (ix < theList.length) {
				var feedUrl = theList [ix];
				console.log ("subscribeList: flSubscribe == " + flSubscribe + ", screenname == " + screenname + ", feedUrl == " + feedUrl);
				process (screenname, feedUrl, function (err, data) {
					if (err) {
						console.log ("subscribeList: err.message == " + err.message + ", screenname == " + screenname + ", feedUrl == " + feedUrl);
						}
					sub (ix + 1);
					});
				}
			else {
				callback (undefined, theList);
				}
			}
		sub (0);
		}
	function getSubscriptions (screenname, callback) {
		var sqltext = "select s.feedUrl, f.title, f.htmlUrl, f.countSubs, f.ctChecks, f.whenUpdated, f.code, f.ctSecs, f.ctErrors, f.ctConsecutiveErrors, f.whenLastError, s.categories from subscriptions as s, feeds as f where s.feedUrl = f.feedUrl and f.title is not null and s.listName = " + davesql.encode (screenname) + " order by s.whenUpdated desc;";
		console.log ("getSubscriptions: sqltext == " + sqltext);
		davesql.runSqltext (sqltext, function (err, result) {
			if (err) {
				callback (err);
				}
			else {
				result.forEach (function (sub) {
					if (sub.categories == null) {
						delete sub.categories;
						}
					});
				callback (undefined, result);
				}
			});
		}
	function getFollowers (feedUrl, callback) { //users who follow feed
		var sqltext = "select listName from subscriptions where feedUrl=" + davesql.encode (feedUrl) + ";";
		davesql.runSqltext (sqltext, function (err, result) {
			if (err) {
				callback (err);
				}
			else {
				var userarray = new Array ();
				if (result !== undefined) { //4/17/18 by DW
					for (var i = 0; i < result.length; i++) {
						userarray.push (result [i].listName);
						}
					}
				callback (undefined, userarray);
				}
			});
		}
	function isSubscribed (screenname, feedUrl, callback) {
		getSubscriptions (screenname, function (err, subs) {
			if (err) {
				callback (err);
				}
			else {
				var flSubscribed = false;
				subs.forEach (function (item) {
					if (item.feedUrl == feedUrl) {
						flSubscribed = true;
						}
					});
				callback (undefined, flSubscribed);
				}
			});
		}
	function getSubscription (screenname, feedUrl, callback) { 
		const sqltext = "select * from subscriptions where listName = " + davesql.encode (screenname) + " and feedurl = " + davesql.encode (feedUrl) + ";";
		davesql.runSqltext (sqltext, function (err, result) {
			if (err) {
				callback (err);
				}
			else {
				var theSubscription;
				if (result.length == 0) {
					theSubscription = new Object (); //empty
					}
				else {
					theSubscription = result [0];
					console.log ("getSubscription: theSubscription == " + utils.jsonStringify (theSubscription));
					if (theSubscription.categories == null) {
						delete theSubscription.categories;
						}
					theSubscription.username = theSubscription.listname;
					delete theSubscription.listname;
					}
				callback (undefined, theSubscription);
				}
			});
		}
	function setCategoriesForSubscription (screenname, feedUrl, catstring, callback) {
		function normalizeCatString (catstring) { //set up so we can query with LIKE verb -- 1/3/21 by DW
			var splits = catstring.split (","), newcatstring = "";
			splits.forEach (function (cat) {
				cat = utils.stringLower (utils.trimWhitespace (cat));
				newcatstring += "," + cat;
				});
			if (newcatstring.length == 0) {
				return (undefined);
				}
			else {
				return (newcatstring + ",");
				}
			}
		const sqltext = "select * from subscriptions where listName = " + davesql.encode (screenname) + " and feedurl = " + davesql.encode (feedUrl) + ";";
		davesql.runSqltext (sqltext, function (err, result) {
			if (err) {
				callback (err);
				}
			else {
				var theSubscription = result [0];
				if (theSubscription === undefined) {
					callback ({message: "Can't set the categories because the user isn't subscribed to the feed."});
					}
				else {
					theSubscription.categories = normalizeCatString (catstring);
					const sqltext = "replace into subscriptions " + davesql.encodeValues (theSubscription);
					davesql.runSqltext (sqltext, function (err, result) {
						callback (undefined, theSubscription);
						});
					}
				}
			});
		}
	function deleteSubscriptions (username, callback) {
		var sqltext = "delete from subscriptions where listName = " + davesql.encode (username) + ";";
		davesql.runSqltext (sqltext, callback);
		}

function hashMD5 (s) {
	return (crypto.createHash ("md5").update (s).digest ("hex"));
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
	const sqltext = "select s.feedUrl, f.title, f.htmlUrl, count(s.feedUrl) as countSubs, f.ctChecks, f.whenUpdated, f.code, f.ctSecs, f.ctErrors, f.ctConsecutiveErrors, f.whenLastError from subscriptions as s, feeds as f where s.feedUrl = f.feedUrl and f.title is not null group by feedUrl order by countSubs desc limit 100;"
	console.log ("getHotlist: sqltext == " + sqltext);
	davesql.runSqltext (sqltext, function (err, result) {
		if (err) {
			callback (err);
			}
		else {
			adjustHotlistCounts (result); 
			callback (undefined, result);
			}
		});
	}
function getFeedInfoFromDatabase (feedUrl, callback) { //as opposed to getting it from the feed itself
	var sqltext = "select * from feeds where feedUrl=" + davesql.encode (feedUrl) + ";";
	davesql.runSqltext (sqltext, function (err, result) {
		if (err) {
			callback (err);
			}
		else {
			if (result.length == 0) {
				callback ({message: "Can't get the info for the feed \"" + feedUrl + "\" because it is not in the database."});
				}
			else {
				callback (undefined, result [0]);
				}
			}
		});
	}
function getFeedInfo (feedUrl, callback) { //get info from the feed itself
	feedRead.parseUrl (feedUrl, config.requestTimeoutSecs, function (err, theFeed, httpResponse) {
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

function httpRequest (theRequest) {
	var params = theRequest.params, now = new Date ();
	var token = (params.oauth_token !== undefined) ? params.oauth_token : undefined;
	var secret = (params.oauth_token_secret !== undefined) ? params.oauth_token_secret : undefined;
	function returnPlainText (s) {
		theRequest.httpReturn (200, "text/plain", s.toString ());
		}
	function returnHtml (htmltext) {
		theRequest.httpReturn (200, "text/html", htmltext.toString ());
		}
	function returnJavascript (javascriptText) {
		theRequest.httpReturn (200, "application/javascript", javascriptText.toString ());
		}
	function returnError (jstruct) {
		theRequest.httpReturn (500, "application/json", utils.jsonStringify (jstruct));
		}
	function returnData (jstruct) {
		if (jstruct === undefined) {
			jstruct = {};
			}
		else {
			if (jstruct.listName !== undefined) {
				jstruct.username = jstruct.listName;
				delete jstruct.listName;
				}
			}
		theRequest.httpReturn (200, "application/json", utils.jsonStringify (jstruct));
		}
	function httpReturn (err, jstruct) {
		if (err) {
			returnError (err);
			}
		else {
			returnData (jstruct);
			}
		}
	function updateUserOpml (screenname) {
		uploadUserOpmlToS3 (screenname, httpReturn);
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
	function returnRiverViewer (screenname) {
		console.log ("returnRiverViewer: screenname == " + screenname);
		getPrefs (screenname, function (err, jstruct) {
			var theCategories = new Array ();
			if (!err) {
				theCategories = jstruct.prefs.categories;
				}
			//set up myConfig
				var myConfig = new Object ();
				function addCategoriesToConfig (theCategories, myConfig) {
					var homePage = {
						panels: [
							]
						};
					theCategories.forEach (function (cat) {
						homePage.panels.push ({
							title: cat.title,
							river: "/getriver?username=" + screenname + "&category=" + cat.name,
							fname: cat.name,
							tip: cat.description,
							flAlwaysUpdate: utils.getBoolean (cat.flAlwaysUpdate),
							flMustHaveEnclosure: utils.getBoolean (cat.flMustHaveEnclosure)
							});
						});
					myConfig.homePage = homePage;
					}
				utils.copyScalars (river6.getConfig (), myConfig);
				addCategoriesToConfig (theCategories, myConfig); //1/4/21 by DW
				myConfig.webSocketPort = myConfig.wsPort; 
			
			request (config.urlRiverViewerPageSource, function (error, response, templatetext) {
				if (!error && response.statusCode == 200) {
					var pagetable = {
						productName: myProductName, 
						productnameForDisplay: "feedBase River",
						version: myVersion,
						urlTwitterServer: "http://localhost:1420/",
						screenname,
						categories: utils.jsonStringify (theCategories)
						};
					pagetable.config = utils.jsonStringify (myConfig); 
					var pagetext = utils.multipleReplaceAll (templatetext, pagetable, false, "[%", "%]");
					returnHtml (pagetext);
					}
				});
			});
		}
	switch (theRequest.lowerpath) {
		case "/": //let the app shell handle it, not River6
			return (false);
		case "/now": 
			returnPlainText (now);
			return (true); 
		case "/getprefs":
			callWithScreenname (function (screenname) {
				getPrefs (screenname, httpReturn);
				});
			return (true); 
		case "/saveprefs":
			callWithScreenname (function (screenname) {
				savePrefs (screenname, params.prefs, httpReturn);
				});
			return (true); 
		case "/subscribe":
			callWithScreenname (function (screenname) {
				subscribe (screenname, params.feedurl, function (err, result) {
					updateUserOpml (screenname);
					httpReturn (err, result);
					});
				});
			return (true); 
		case "/unsubscribe": 
			callWithScreenname (function (screenname) {
				unsubscribe (screenname, params.feedurl, function (err, result) {
					updateUserOpml (screenname);
					httpReturn (err, result);
					});
				});
			return (true); 
		case "/subscribelist": case "/unsubscribelist": //12/26/20 by DW
			callWithScreenname (function (screenname) {
				var theList;
				try {
					theList = JSON.parse (params.list);
					}
				catch (err) {
					returnError (err);
					return (true);
					}
				var flSubscribe = theRequest.lowerpath == "/subscribelist";
				subscribeList (screenname, theList, flSubscribe, function (err, result) {
					updateUserOpml (screenname);
					httpReturn (err, result);
					});
				});
			return (true); 
		case "/issubscribed":
			callWithScreenname (function (screenname) {
				isSubscribed (screenname, params.feedurl, httpReturn);
				});
			return (true);
		case "/getsubs":
			getSubscriptions (params.username, function (err, subsArray) {
				if (err) {
					returnError (err);
					}
				else {
					var jstruct = {
						opmlUrl: getUserOpmlUrl (params.username),
						theSubs: subsArray
						};
					returnData (jstruct);
					}
				});
			return (true);
		case "/getfollowers":
			getFollowers (params.feedurl, httpReturn);
			return (true); 
		case "/getsubscription": 
			callWithScreenname (function (screenname) {
				getSubscription (screenname, params.feedurl, httpReturn);
				});
			return (true); 
		case "/getfeedinfo":
			getFeedInfoFromDatabase (params.feedurl, httpReturn);
			return (true); 
		case "/setcategories": 
			callWithScreenname (function (screenname) {
				setCategoriesForSubscription (screenname, params.feedurl, params.catstring, function (err, theSubscription) {
					if (err) {
						returnError (err);
						}
					else {
						updateUserOpml (screenname);
						returnData (theSubscription);
						}
					});
				});
			return (true);
		case "/hotlist":
			getHotlist (httpReturn);
			return (true); //we handled it
		case "/deleteallsubs": //3/9/18 by DW
			return (true); 
		case "/saveopml":
			callWithScreenname (function (screenname) {
				console.log ("/saveopml: theRequest.postBody.length == " + theRequest.postBody.length);
				userUploadedOpml (screenname, theRequest.postBody, function (err, theList) {
					if (err) {
						returnError (err);
						}
					else {
						updateUserOpml (screenname);
						returnData (theList);
						}
					});
				});
			return (true); //we handled it
		case "/readfeed": 
			getFeedInfo (params.feedurl, httpReturn);
			return (true); 
		case "/readfeedincludeeverything":
			readFeedIncludeEverything (params.feedurl, httpReturn);
			return (true); 
		case "/updateopml": 
			callWithScreenname (function (screenname) {
				updateUserOpml (screenname);
				});
			return (true);
		case "/whereismyopml":
			callWithScreenname (function (screenname) {
				getUserOpmlList (screenname, httpReturn);
				});
			return (true);
		case "/getriver":
			river6.getRiverText (params.username, function (err, rivertext) {
				if (err) {
					returnError (err);
					}
				else {
					returnJavascript (rivertext);
					}
				}, params.category);
			return (true);
		case "/viewriver":
			returnRiverViewer (params.username);
			return (true);
		case "/stats": case "/stats.json":
			returnData (river6.getStats ());
			return (true);
		default: 
			return (false); //not handled
		}
	}

function leastRecentlyUpdatedFeed (callback) {
	var sqltext = "select * from feeds order by whenUpdated asc limit 1;";
	davesql.runSqltext (sqltext, function (err, result) {
		if (err) {
			callback (err);
			}
		else {
			if (result.length > 0) { 
				callback (undefined, result [0]);
				}
			else {
				callback (undefined, undefined);
				}
			}
		});
	}
function updateOneFeed (feedUrl, callback) {
	river6.readFeed (feedUrl, false, function (err, theFeed) {
		if (err) {
			console.log ("updateOneFeed: err.message == " + err.message);
			if (callback !== undefined) {
				callback (err);
				}
			}
		else {
			console.log ("updateOneFeed: feedUrl == " + feedUrl);
			var f = config.savedFeedInfoFolder + hashMD5 (feedUrl) + "/" + config.fnameFeedInfo;
			utils.sureFilePath (f, function () {
				fs.writeFile (f, utils.jsonStringify (theFeed), function (err) {
					});
				});
			if (callback !== undefined) {
				callback (undefined, theFeed);
				}
			}
		});
	}
function updateLeastRecentlyUpdatedFeed (callback) {
	leastRecentlyUpdatedFeed (function (err, theFeed) {
		if (err) {
			callback (err);
			}
		else {
			if (theFeed === undefined) {
				callback ({message: "Can't find a feed to update."});
				}
			else {
				updateOneFeed (theFeed.feedUrl, callback);
				}
			}
		});
	
	}

function everyMinute () {
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
	}
daveappserver.start (appOptions, function (appConfig) {
	appConfig.http = { //we don't want River6's http server to respond
		enabled: false
		};
	river6.start (appConfig, function () {
		});
	});




