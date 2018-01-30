//standalone app that loads new code from an s3 location
	//this way is much faster and more dependable than Dropbox
	//makes the development run much faster
	//I keep this running on the server when I am in development mode
	//1/30/18 by DW
const folderloader = require ("s3folderloader");
const utils = require ("daveutils");
const davehttp = require ("davehttp");  

const config = {
	port: 1406,
	flLogToConsole: true,
	flAllowAccessFromAnywhere: true, //for davehttp
	s3path: "/scripting.com/code/feedbase/"
	};
davehttp.start (config, function (theRequest) {
	switch (theRequest.lowerpath) {
		case "/reload":
			folderloader.load (config.s3path, "./", function (logtext) {
				if (logtext.length == 0) {
					logtext = "No changes.";
					}
				theRequest.httpReturn (200, "text/html", logtext);
				});
			return;
		}
	theRequest.httpReturn (404, "text/plain", "Not found.");
	});
