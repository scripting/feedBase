var myProductName = "feedBase", myVersion = "0.4.12";     

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
	urlServerHomePageSource: undefined,
	outlineImportFolder: "outlines/",
	usersFolder: "users/",
	fnamePrefs: "prefs.json",
	fnameOpml: "subs.opml",
	port: 1405,
	flLogToConsole: true,
	flAllowAccessFromAnywhere: true, //for davehttp
	s3path: "/scripting.com/code/feedbase/",
	requestTimeoutSecs: 3
	};
const fnameConfig = "config.json";

var ctFeeds = 0;

var theSqlConnection = undefined;
var theSqlConnectionPool = undefined; 

function formatDateTime (when) {
	if (when === undefined) {
		when = new Date ();
		}
	return (dateFormat (new Date (when), "yyyy-mm-dd HH:MM:ss"));
	}
function encode (s) {
	return (mysql.escape (s));
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

function addSubscriptionToDatabase (username, listname, feedurl, callback) {
	var now = formatDateTime (new Date ());
	var sqltext = "REPLACE INTO subscriptions (username, listname, feedurl, whenupdated) VALUES (" + encode (username) + ", " + encode (listname) + ", " + encode (feedurl) + ", " + encode (now) + ");";
	runSqltext (sqltext, function (result) {
		if (callback !== undefined) {
			callback (result);
			}
		});
	}
function addFeedToDatabase (feedUrl, callback) {
	console.log ("addFeedToDatabase: feedUrl == " + feedUrl);
	getFeedInfo (feedUrl, function (info) {
		if (info !== undefined) {
			var now = formatDateTime (new Date ());
			var sqltext = "REPLACE INTO feeds (feedurl, title, htmlurl, description, whenupdated) VALUES (" + encode (feedUrl) + ", " + encode (info.title) + ", " + encode (info.htmlUrl) + ", " + encode (info.description) + ", "+ encode (now) + ");";
			console.log (sqltext);
			runSqltext (sqltext, function (result) {
				if (callback !== undefined) {
					callback (result);
					}
				});
			}
		else {
			if (callback !== undefined) {
				callback (undefined);
				}
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
	var sqltext = "SELECT s.feedurl, f.title, f.htmlurl FROM subscriptions AS s, feeds AS f WHERE s.feedurl = f.feedurl AND s.username = " + encode (username) + " ORDER BY s.whenupdated DESC;";
	console.log ("getUserSubscriptions: sqltext == " + sqltext);
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
				callback (undefined);
				}
			});
		req.on ("error", function (response) {
			console.log ("readFeed: response.statusCode == " + response.statusCode);
			callback (undefined);
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
	readFeed (feedUrl, function (feedItems) {
		if ((feedItems === undefined) || (feedItems.length == 0)) {
			callback (undefined);
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
	function returnServerHomePage () { //return true if we handled it
		if (config.urlServerHomePageSource === undefined) {
			return (false);
			}
		request (config.urlServerHomePageSource, function (error, response, templatetext) {
			if (!error && response.statusCode == 200) {
				var pagetable = {
					productName: myProductName,
					version: myVersion
					};
				var pagetext = utils.multipleReplaceAll (templatetext, pagetable, false, "[%", "%]");
				returnHtml (pagetext);
				}
			else {
				returnNotFound ();
				}
			});
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
			callWithScreenname (function (screenname) {
				getUserSubscriptions (screenname, function (result) {
					returnData (result);
					});
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

function startup () {
	console.log ("\n" + myProductName + " v" + myVersion + "\n");
	readConfig (function () {
		console.log ("config == " + utils.jsonStringify (config));
		theSqlConnectionPool = mysql.createPool (config.database);
		
		config.twitter.httpRequestCallback = handleHttpRequest;
		davetwitter.start (config.twitter, function () {
			});
		});
	}
startup ();
