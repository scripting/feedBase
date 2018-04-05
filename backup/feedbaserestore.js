var myProductName = "feedBaseRestore", myVersion = "0.4.0";     

const mysql = require ("mysql");
const utils = require ("daveutils");
const fs = require ("fs");
const dateFormat = require ("dateformat");

var config = {
	backupFolderPath: ""
	};
const fnameConfig = "config.json";

var theFeeds, flFeedQueryPending = false, ixNextFeed = 0, feedInterval;
var theSubscriptions, flSubscriptionQueryPending = false, ixNextSubscription = 0, subscriptionInterval;

function encode (s) {
	return (mysql.escape (s));
	}
function formatDateTime (when) {
	if (when === undefined) {
		when = new Date ();
		}
	return (dateFormat (new Date (when), "yyyy-mm-dd HH:MM:ss"));
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

function checkSubscriptionQueue () { //called every tenth second
	if (!flSubscriptionQueryPending) {
		if (ixNextSubscription >= theSubscriptions.length) {
			clearInterval (subscriptionInterval); //advance to next state; 
			feedInterval = setInterval (checkFeedQueue, 10); 
			}
		else {
			flSubscriptionQueryPending = true;
			var whenstart = new Date ();
			try {
				var theSubscription = theSubscriptions [ixNextSubscription++];
				
				if (theSubscription.whenupdated != null) {
					theSubscription.whenupdated = formatDateTime (theSubscription.whenupdated);
					}
				
				var sqltext = "replace into subscriptions " + encodeValues (theSubscription);
				runSqltext (sqltext, function (result) {
					console.log ("#" + ixNextSubscription + ": " + theSubscription.username + ", " + utils.secondsSince (whenstart) + " secs.");
					flSubscriptionQueryPending = false;
					});
				}
			catch (err) {
				console.log (err.message);
				flSubscriptionQueryPending = false;
				}
			}
		}
	}
function checkFeedQueue () { //called every tenth second
	if (!flFeedQueryPending) {
		if (ixNextFeed >= theFeeds.length) {
			clearInterval (feedInterval); //advance to next state; 
			console.log ("Have a nice day.");
			process.exit (); //exit to OS
			}
		else {
			flFeedQueryPending = true;
			var whenstart = new Date ();
			try {
				var theFeed = theFeeds [ixNextFeed++];
				
				if (theFeed.whenUpdated != null) {
					theFeed.whenUpdated = formatDateTime (theFeed.whenUpdated);
					}
				if (theFeed.whenLastError != null) {
					theFeed.whenLastError = formatDateTime (theFeed.whenLastError);
					}
				
				var sqltext = "replace into feeds " + encodeValues (theFeed);
				runSqltext (sqltext, function (result) {
					console.log ("#" + ixNextFeed + ": " + theFeed.feedUrl + ", " + utils.secondsSince (whenstart) + " secs.");
					flFeedQueryPending = false;
					});
				}
			catch (err) {
				console.log (err.message);
				flFeedQueryPending = false;
				}
			}
		}
	}
function readFeeds (callback) {
	fs.readFile (config.backupFolderPath + "feeds.json", function (err, jsontext) {
		theFeeds = JSON.parse (jsontext);
		callback ();
		});
	}
function readSubscriptions (callback) {
	fs.readFile (config.backupFolderPath + "subscriptions.json", function (err, jsontext) {
		theSubscriptions = JSON.parse (jsontext);
		callback ();
		});
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
function everySecond () {
	if (utils.secondsSince (stats.whenLastFeedUpdate) > config.ctSecsBetwFeedUpdates) {
		stats.whenLastFeedUpdate = new Date ();
		updateLeastRecentlyUpdatedFeed (function () {
			stats.ctFeedUpdates++;
			stats.ctFeedUpdatesToday++;
			stats.ctFeedUpdatesThisRun++;
			statsChanged ();
			});
		}
	if (flStatsChanged) {
		flStatsChanged = false;
		writeStats ();
		}
	writeLogIfChanged (); //3/26/18 by DW
	}
readConfig (function () {
	console.log ("config == " + utils.jsonStringify (config));
	theSqlConnectionPool = mysql.createPool (config.database);
	readSubscriptions (function () {
		readFeeds (function () {
			subscriptionInterval = setInterval (checkSubscriptionQueue, 10); 
			});
		});
	});
