var myProductName = "feedBase", myVersion = "0.4.18";     

const mysql = require ("mysql");
const utils = require ("daveutils");
const fs = require ("fs");
const request = require ("request");
const opml = require ("daveopml");
const dateFormat = require ("dateformat");
const s3 = require ("daves3"); 
const folderloader = require ("s3folderloader");
const davehttp = require ("davehttp"); 
const davetwitter = require ("davetwitter");
var feedParser = require ("feedparser");

var config = {
	ctSecsBetwFeedUpdates: 5,
	urlServerHomePageSource: undefined,
	outlineImportFolder: "outlines/",
	usersFolder: "users/",
	fnamePrefs: "prefs.json", //each user's prefs file
	fnameOpml: "subs.opml",
	fnameStats: "data/stats.json", //stats for the app
	port: 1405,
	flLogToConsole: true,
	flAllowAccessFromAnywhere: true, //for davehttp
	s3path: "/scripting.com/code/feedbase/",
	requestTimeoutSecs: 3,
	homepage: {
		pagetitle: "feedBase"
		},
	urlFavicon: "http://scripting.com/favicon.ico",
	ctSecsHomepageCache: 1 //set it higher for stable production server
	};
const fnameConfig = "config.json";

var stats = {
	ctFeedUpdates: 0,
	whenLastFeedUpdate: new Date (),
	lastFeedUpdate: {
		}
	};
var flStatsChanged = false;


var theSqlConnectionPool = undefined; 

var flOneHitInLastMinute = false;

var whenLastHomepageRead = new Date (0), homepageCache = undefined;


function statsChanged () {
	flStatsChanged = true;
	}
function processHomepageText (s) { //2/1/18 by DW
	var pagetable = new Object (), pagetext;
	utils.copyScalars (config.homepage, pagetable);
	pagetable.productName = myProductName;
	pagetable.version = myVersion;
	pagetable.configJson = utils.jsonStringify (pagetable);
	console.log ("processHomepageText: pagetable == " + utils.jsonStringify (pagetable));
	pagetext = utils.multipleReplaceAll (s, pagetable, false, "[%", "%]");
	return (pagetext);
	}
function formatDateTime (when) {
	if (when === undefined) {
		when = new Date ();
		}
	return (dateFormat (new Date (when), "yyyy-mm-dd HH:MM:ss"));
	}
function encode (s) {
	return (mysql.escape (s));
	}
function encodeValues (values) {
	var part1 = "", part2 = "";
	for (var x in values) { //generate something like this: (feedurl, title, htmlurl, description, whenupdated)
		if (part1.length > 0) {
			part1 += ", ";
			}
		part1 += x;
		}
	for (var x in values) { //and this: ('http://scripting.com/rss.xml', Scripting News', 'http://scripting.com/', 'Even worse etc', '2018-02-04 12:04:08')
		if (part2.length > 0) {
			part2 += ", ";
			}
		part2 += encode (values [x]);
		}
	return ("(" + part1 + ") values (" + part2 + ");");
	}
function runSqltext (s, callback) {
	theSqlConnectionPool.getConnection (function (err, connection) {
		if (err) {
			console.log ("runSqltext: err.code == " + err.code + ", err.message == " + err.message);
			}
		else {
			connection.query (s, function (err, result) {
				connection.release ();
				if (err) {
					console.log ("runSqltext: err.code == " + err.code + ", err.message == " + err.message);
					if (callback !== undefined) {
						callback (undefined);
						}
					}
				else {
					if (callback !== undefined) {
						callback (result);
						}
					}
				});
			}
		});
	}

function resetFeedSubCount (feedUrl, callback) { //set the ctSubs column for the indicated feed in the feeds table
	var sqltext = "SELECT count(*) AS c FROM subscriptions WHERE feedurl=" + encode (feedUrl);
	runSqltext (sqltext, function (resultCount) {
		var firstLine = resultCount [0];
		sqltext = "UPDATE feeds SET countSubs = " + firstLine.c + " WHERE feedurl = " + encode (feedUrl);
		runSqltext (sqltext, function (resultUpdate) {
			if (callback !== undefined) {
				callback (resultUpdate);
				}
			});
		});
	}
function addSubscriptionToDatabase (username, listname, feedurl, callback) {
	var now = formatDateTime (new Date ());
	var sqltext = "REPLACE INTO subscriptions (username, listname, feedurl, whenupdated) VALUES (" + encode (username) + ", " + encode (listname) + ", " + encode (feedurl) + ", " + encode (now) + ");";
	runSqltext (sqltext, function (result) {
		resetFeedSubCount (feedurl, function (resetResult) {
			if (callback !== undefined) {
				callback (result);
				}
			});
		});
	}
function addFeedToDatabase (feedUrl, callback) {
	var whenstart = new Date ();
	getFeedInfo (feedUrl, function (info, httpResponse) {
		var values = {
			feedurl: feedUrl,
			whenupdated: formatDateTime (whenstart),
			code: 200,
			ctsecs: utils.secondsSince (whenstart)
			};
		
		function updateRecord (values, callback) {
			var sqltext = "replace into feeds " + encodeValues (values);
			stats.lastFeedUpdate = values;
			runSqltext (sqltext, function (result) {
				resetFeedSubCount (feedUrl, callback);
				});
			}
		if (info !== undefined) {
			values.title = info.title;
			values.htmlurl = info.htmlUrl;
			values.description = info.description;
			updateRecord (values, callback);
			}
		else {
			if (httpResponse !== undefined) { //2/4/18 by DW
				if (httpResponse.statusCode !== undefined) {
					values.code = httpResponse.statusCode;
					}
				}
			updateRecord (values, callback); //always update feed so whenupdated value changes
			}
		});
	}
function getHotlist (callback) {
	const sqltext = "SELECT subscriptions.feedurl, feeds.title, feeds.htmlurl, COUNT(subscriptions.feedurl) AS countSubs FROM subscriptions, feeds WHERE subscriptions.feedurl = feeds.feedurl GROUP BY feedurl ORDER BY countSubs DESC LIMIT 100;";
	runSqltext (sqltext, function (result) {
		callback (result);
		});
	}
function getKnownFeeds (callback) {
	var sqltext = "select distinct feedurl from subscriptions;";
	runSqltext (sqltext, function (result) {
		var feeds = new Array ();
		for (var i = 0; i < result.length; i++) {
			feeds.push (result [i].feedurl);
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
function deleteSubscriptions (username, listname, callback) {
	var sqltext = "delete from subscriptions where username = " + encode (username) + " and listname = " + encode (listname) + ";";
	runSqltext (sqltext, function (result) {
		callback (result);
		});
	}
function getUserSubscriptions (username, callback) {
	var sqltext = "SELECT s.feedurl, f.title, f.htmlurl, f.countSubs FROM subscriptions AS s, feeds AS f WHERE s.feedurl = f.feedurl AND s.username = " + encode (username) + " ORDER BY s.whenupdated DESC;";
	runSqltext (sqltext, function (result) {
		callback (result);
		});
	}
function getUserOpmlSubscriptions (username, callback) {
	getPrefs (username, function (err, jstruct) {
		var now = new Date (), whenCreated;
		try {
			whenCreated = jstruct.prefs.whenFirstStartup;
			}
		catch (err) {
			whenCreated = now;
			}
		getUserSubscriptions (username, function (feedsArray) {
			var opmltext = "", indentlevel = 0;
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
				add ("<title>Subscriptions for \"" + encode (username) + "\"</title>");
				add ("<dateCreated>" + new Date (whenCreated).toUTCString () + "</dateCreated>");
				add ("<dateModified>" + now.toUTCString () + "</dateModified>");
				add ("</head>"); indentlevel--;
			add ("<body>"); indentlevel++;
			//add the <outline> elements
				for (i = 0; i < feedsArray.length; i++) {
					var feed = feedsArray [i];
					function att (name, val) {
						if ((val === undefined) || (val === null)) {
							return ("");
							}
						else {
							return (" " + name + "=\"" + utils.encodeXml (val) + "\"");
							}
						}
					add ("<outline type=\"rss\"" + att ("text", feed.title) + att ("xmlUrl", feed.feedurl) + att ("htmlUrl", feed.htmlurl) +  " />");
					}
			add ("</body>"); indentlevel--;
			add ("</opml>"); indentlevel--;
			callback (undefined, opmltext);
			});
		});
	}
function getFeedInfoFromDatabase (feedUrl, callback) { //as opposed to getting it from the feed itself
	var sqltext = "SELECT * FROM feeds WHERE feedurl=" + encode (feedUrl) + ";";
	runSqltext (sqltext, function (result) {
		callback (result [0]);
		});
	}
function getUsersWhoFollowFeed (feedUrl, callback) {
	var sqltext = "select username from subscriptions where feedurl=" + encode (feedUrl) + ";";
	runSqltext (sqltext, function (result) {
		var userarray = new Array ();
		for (var i = 0; i < result.length; i++) {
			userarray.push (result [i].username);
			}
		callback (userarray);
		});
	}
function updateLeastRecentlyUpdatedFeed (callback) {
	var sqltext = "SELECT * FROM feeds ORDER BY whenupdated ASC LIMIT 1;";
	runSqltext (sqltext, function (result) {
		var theFeed = result [0];
		addFeedToDatabase (theFeed.feedurl, function (addResult) {
			if (callback !== undefined) {
				callback (result);
				}
			});
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

function readFeed (feedUrl, callback) {
	try {
		var requestOptions = {
			url: feedUrl,
			timeout: config.requestTimeoutSecs * 1000
			};
		var req = request (requestOptions);
		var feedparser = new feedParser ();
		var feedItems = new Array ();
		req.on ("response", function (response) {
			var stream = this;
			if (response.statusCode == 200) {
				stream.pipe (feedparser);
				}
			else {
				console.log ("readFeed: response.statusCode == " + response.statusCode);
				callback (undefined, response);
				}
			});
		req.on ("error", function (response) {
			console.log ("readFeed: response.statusCode == " + response.statusCode);
			callback (undefined, response);
			});
		feedparser.on ("readable", function () {
			try {
				var item = this.read (), flnew;
				if (item !== null) {
					feedItems.push (item);
					}
				}
			catch (err) {
				console.log ("readFeed: error == " + err.message);
				}
			});
		feedparser.on ("error", function () {
			});
		feedparser.on ("end", function () {
			callback (feedItems);
			});
		}
	catch (err) {
		console.log ("readFeed: err.message == " + err.message);
		callback (undefined);
		}
	}
function getFeedInfo (feedUrl, callback) {
	readFeed (feedUrl, function (feedItems, httpResponse) {
		if ((feedItems === undefined) || (feedItems.length == 0)) {
			callback (undefined, httpResponse);
			}
		else {
			var item = feedItems [0];
			var info = {
				title: item.meta.title,
				htmlUrl: item.meta.link,
				description: item.meta.description
				}
			callback (info);
			}
		});
	}

function readOpmlSubscriptionList (f, flExpandIncludes, callback) { //read OPML file, parse, call back with a list of feeds contained in the file
	opml.readOpmlFile (f, function (theOutline) {
		if (theOutline !== undefined) {
			var feedlist = new Array ();
			for (var i = 0; i < theOutline.subs.length; i++) {
				var feed = theOutline.subs [i];
				if (feed.xmlurl !== undefined) {
					feedlist.push (feed.xmlurl);
					}
				}
			callback (feedlist);
			}
		else {
			callback (undefined);
			}
		}, flExpandIncludes);
	}
function importOpmlFiles (callback) { //imports outlines from the previous version of SYO
	function isFolder (f) {
		return (fs.lstatSync (f).isDirectory ());
		}
	function loadUserFolder (username) {
		var userfolder = config.outlineImportFolder + username;
		if (isFolder (userfolder)) {
			console.log (userfolder);
			fs.readdir (userfolder, function (err, filelist) {
				if (err) {
					console.log ("importOpmlFiles: err.message == " + err.message);
					}
				else {
					for (var i = 0; i < filelist.length; i++) {
						let fname = filelist [i], f = userfolder + "/" + fname;
						readOpmlSubscriptionList (f, false, function (feedlist) {
							if (feedlist !== undefined) {
								for (var j = 0; j < feedlist.length; j++) {
									let urlfeed = feedlist [j];
									addSubscriptionToDatabase (username, fname, urlfeed);
									}
								}
							});
						}
					}
				});
			}
		}
	fs.readdir (config.outlineImportFolder, function (err, userlist) {
		if (err) {
			console.log ("importOpmlFiles: err.message == " + err.message);
			}
		else {
			for (var i = 0; i < userlist.length; i++) {
				loadUserFolder (userlist [i]);
				}
			}
		if (callback !== undefined) {
			callback ();
			}
		});
	}
function processOpmlFile (f, screenname, callback) { //what we do when the user submits an OPML file
	readOpmlSubscriptionList (f, false, function (feedlist) {
		if (feedlist !== undefined) {
			var fname = utils.stringLastField (f, "/");
			deleteSubscriptions (screenname, fname, function (result) {
				for (var i = 0; i < feedlist.length; i++) {
					let urlfeed = feedlist [i];
					addSubscriptionToDatabase (screenname, fname, urlfeed);
					}
				});
			callback (undefined); //no error
			}
		else {
			callback ({message: "Can't process the subscription list because it is not a valid OPML file."});
			}
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
			processOpmlFile (opmlFile, screenname, function (err) {
				callback (err, true);
				});
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
	console.log ("savePrefs: screenname == " + screenname + ", jsontext == " + jsontext);
	utils.sureFilePath (prefsFile, function () {
		fs.writeFile (prefsFile, jsontext, function (err) {
			callback (err, true);
			});
		});
	}

function handleHttpRequest (theRequest) {
	var token = (theRequest.params.oauth_token !== undefined) ? theRequest.params.oauth_token : undefined;
	var secret = (theRequest.params.oauth_token_secret !== undefined) ? theRequest.params.oauth_token_secret : undefined;
	
	flOneHitInLastMinute = true;
	
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
			theRequest.httpReturn (200, "text/plain", new Date ());
			return (true); //we handled it
		case "/reload":
			folderloader.load (config.s3path, "./", function (logtext) {
				if (logtext.length == 0) {
					logtext = "No changes.";
					}
				theRequest.httpReturn (200, "text/html", logtext);
				});
			return (true); //we handled it
		case "/hotlist":
			getHotlist (function (result) {
				theRequest.httpReturn (200, "application/json", utils.jsonStringify (result));
				});
			return (true); //we handled it
		case "/stats":
			returnData (stats);
			return (true); //we handled it
		case "/getfeedinfo":
			getFeedInfoFromDatabase (theRequest.params.feedurl, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/getfollowers":
			getUsersWhoFollowFeed (theRequest.params.feedurl, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/knownfeeds":
			getKnownFeeds (function (result) {
				theRequest.httpReturn (200, "application/json", utils.jsonStringify (result));
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
				getUserOpml (screenname, function (result) {
					returnData (result);
					});
				});
			return (true); //we handled it
		case "/saveopml":
			callWithScreenname (function (screenname) {
				saveUserOpml (screenname, theRequest.params.opmltext, function (err, result) {
					httpReturn (err, result);
					});
				});
			return (true); //we handled it
		case "/getsubs":
			getUserSubscriptions (theRequest.params.username, function (result) {
				returnData (result);
				});
			return (true); //we handled it
		case "/getopmlsubs":
			getUserOpmlSubscriptions (theRequest.params.username, function (err, opmltext) {
				if (err) {
					returnError (err);
					}
				else {
					returnXml (opmltext);
					}
				});
			return (true); //we handled it
		case "/favicon.ico":
			returnRedirect (config.urlFavicon);
			break;
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
	if (flOneHitInLastMinute) {
		console.log ("");
		flOneHitInLastMinute = false;
		}
	console.log (myProductName + " v" + myVersion + ": " + timestring + ".\n");
	readConfig ();
	}
function everySecond () {
	if (utils.secondsSince (stats.whenLastFeedUpdate) > config.ctSecsBetwFeedUpdates) {
		stats.whenLastFeedUpdate = new Date ();
		updateLeastRecentlyUpdatedFeed (function () {
			stats.ctFeedUpdates++;
			statsChanged ();
			});
		}
	if (flStatsChanged) {
		flStatsChanged = false;
		writeStats ();
		}
	}
function startup () {
	console.log ("\n" + myProductName + " v" + myVersion + "\n");
	readStats (function () {
		readConfig (function () {
			console.log ("config == " + utils.jsonStringify (config));
			theSqlConnectionPool = mysql.createPool (config.database);
			
			config.twitter.httpRequestCallback = handleHttpRequest;
			davetwitter.start (config.twitter, function () {
				});
			setInterval (everySecond, 1000); 
			utils.runAtTopOfMinute (function () {
				setInterval (everyMinute, 60000); 
				everyMinute ();
				});
			
			
			
			
			});
		});
	}
startup ();
