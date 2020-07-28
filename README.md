# OddsBot
Slack Bot that allows users to levy odds challenges against each other and helps resolve them

## Features
The odds challenge, in short, is when someone says to someone else, "Odds you do [x]?".  The challenged then says a number greater than 1 to set the upper bounds of their odds.  After this, both the initiator and the challenged count down from 3 and then say a number between 1 and the previously set upper bounds.  If both people happen to say the same number, the challenged must then complete the task assigned by the initiator.  This bot enables such interactions in Slack organization by facilitating the following slash commands:
1. /odds - allows anyone to initiate an odds challenge against another organization member by @'ing them and then putting in the challenge they wish to see the other complete
2. /setodds - allows someone who's been challenged to set the upper limit for their odds challenge
3. /commitodds - allows both the initiator and the challenged to input their personal odds number PRIVATELY, then displays the results when both have sent their inputs
4. /cancelodds - allows anyone tied to an active challenge to cancel the challenge at any time
The above interactions are facilitated through a combination of a redis database and the app itself.

## Install/Setup Guide
For this app to run locally on your machine, you'll need the following:
* [node.js](https://nodejs.org/en/) (provides access to the node package manager, which you'll need to download/install this project's dependencies)
* A [Slack](https://slack.com/) organization to connect your bot to
* [ngrok](https://ngrok.com/) (allows for quick and easy port forwarding so you can simulate a server on your local machine)
* [redis cloud database](https://redislabs.com/redis-enterprise-cloud/pricing/) (lightweight and free storage for outstanding challenges)
After all of that's on-hand, follow these steps to get a copy of the bot running locally
1. follow [this](https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071) guide for getting an ngrok local server up and attaching it to your version of the bot in your organization (note that every time you reboot ngrok it gives you a new address to forward it to that you'll have to update the slash commands with)
2. npm install the dependencies
3. run `node index.js` or just `start` to start the application
4. try it out in your slack organization!

## Known Bugs
* As of right now, people are only supposed to be able to have one active challenge tied to them at a time, but due to the way the app is structured, one person can be challenged by multiple people, which can only be resolved by the challenged person cancelling all of the challenges they're tied to one by one, or resolving them one by one.
* /commitodds SOMETIMES doesn't recognize valid Number inputs, despite /setodds having the same Number check and seemingly never having this issue.

## Related Media
* [Details on slash commands](https://api.slack.com/interactivity/slash-commands#best_practices)
* [Regex cheat sheet](https://www.rexegg.com/regex-quickstart.html)
* [Node Express Slack API example](https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js)
* [How to flush your db](https://docs.redislabs.com/latest/rc/how-to/flush-db/) (requires you to download redis-cli globally (ie not via npm))
* [Redis commands](https://redis.io/commands)
* In addition, looking up the documentation of all the dependencies on [the npm website](https://www.npmjs.com/) will probably be helpful
