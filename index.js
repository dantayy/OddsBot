// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require(`dotenv`).config();

const express = require(`express`); // significantly simplifies app routing
const bodyParser = require(`body-parser`); // helps to parse request bodies
const redis = require(`ioredis`); // allows us to set up a redis client locally
const slack = require(`slack`); // allows on the fly slack interaction while handling the main payload

// client that will connect to the redis db and handle interactions between slack and the db
let redisClient = new redis({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOSTNAME,
  password: process.env.REDIS_PASSWORD,
});

// direct connection to the bot
let token = process.env.SLACK_AUTH_TOKEN;
let sBot = new slack({token});

// Creates express app
const app = express();
// The port used for Express server
const PORT = 3000;
// Starts server
app.listen(process.env.PORT || PORT, function () {
  console.log('Bot is listening on port ' + PORT);
});

app.use(bodyParser.urlencoded({ extended: true })); // prepares the body parser to handle info encoded in a url
app.use(bodyParser.json()); // prepares the body parser to handle json

// Attach the slash command handler
app.post('/', bodyParser.urlencoded({ extended: false }), slackSlashCommand);

// Slack slash command handler
function slackSlashCommand(req, res) {
  let responseJSON; // obj to be filled with data based on which case is met by the user's request and then sent back at the end
  redisHashGetAllHelper(req.body.user_id).then(hashObj => { // all commands need info on any challenge relating to this user, so grab that from the db first, then check all the cases
    console.log("Here's the returned hashObj from redisHashGetAllHelper: " + JSON.stringify(hashObj));
    // odds initiation
    if (req.body.command === '/odds') {
      if (!req.body.text.includes("<@")) { // bad case: no user specified
        responseJSON = {
          text: "You need to specify who you're challenging!"
        };
      }
      else if (hashObj) { // bad case: active challenge
        responseJSON = {
          text: "People can only have one outstanding challenge at a time, so you or they must resolve it first or cancel with /cancelodds",
        };
        // FIXME: With the current implementation, we can prevent users from initiating multiple challenges, but can't prevent others from being challenged multiple times
      }
      else {
        let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; // grab the id of the challenged
        if (req.body.user_id === challengedID) {  // bad case: trying to challenge themselves
          responseJSON = {
            text: "You can't challenge yourself numbnuts!",
          };
        }
        else { // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
          let initiatorChallengedHash = req.body.user_id + "|" + challengedID; // challenge hash always puts initiator to the left and challenged to the right
          redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
          redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
          redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
          responseJSON = {
            response_type: "in_channel",
            text: "<@" + req.body.user_id + "> has initiated an odds challenge against <@" + challengedID + ">",
          };
          sBot.chat.postEphemeral({
            channel: req.body.channel_id,
            text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
            user: challengedID,
          });
        }
      }
    }
    // setting upper limit of odds
    else if (req.body.command === '/setodds') {
      if (!hashObj) { // bad case: this user has no active challenge
        responseJSON = {
          text: "You have no active challenge!"
        };
      }
      else {
        if (hashObj.isInitiator) { // bad case: this user is the initiator
          responseJSON = {
            text: "You are not the challenged, and therefor cannot set the odds!"
          };
        }
        else {
          if (hashObj.upperLimit != 0) { // bad case: upper limit already set
            responseJSON = {
              text: "You can't reset the upper limit!"
            };
          }
          else {
            let uL = null;
            if(req.body.text.match(`[0-9]+`))
              uL = req.body.text.match(`[0-9]+`)[0];
            console.log("Upper limit readout: " + uL);
            if (!uL || uL <= 1 || uL >= Number.MAX_VALUE) { // bad case: no valid iteger in text
              responseJSON = {
                text: "You need enter a valid integer!"
              };
            } else {
              redisClient.hset(hashObj.hash, 'upperLimit', uL, redis.print);
              responseJSON = {
                text: "Upper limit has been set to " + uL + ", now both of you must enter a value betweeen 1 and that number with /commitodds"
              };
              sBot.chat.postEphemeral({
                channel: req.body.channel_id,
                text: "Upper limit has been set to " + uL + ", now both of you must enter a value betweeen 1 and that number with /commitodds",
                user: hashObj.initiatorID,
              });
            }
          }
        }
      }
    }
    // commiting an inividual's odds number
    else if (req.body.command === '/commitodds') {
      if (!hashObj) { // bad case: this user has no active challenge
        responseJSON = {
          text: "You have no active challenge!"
        };
      }
      else {
        let iOdds = hashObj.initiatorOdds;
        let cOdds = hashObj.challengedOdds;
        let userOdds = null;
        if (hashObj.upperLimit == 0) { // bad case: upper limit not set
          responseJSON = {
            text: "Upper limit hasn't been set yet!"
          };
        }
        else {
          if(req.body.text.match(`[0-9]+`))
            userOdds = req.body.text.match(`[0-9]+`)[0];
          console.log("User odds: " + userOdds)
          if (!userOdds || userOdds < 1 || userOdds > hashObj.upperLimit) { // bad case: no valid integer in text
            responseJSON = {
              text: "You need enter a valid integer!  It must be between 1 and " + hashObj.upperLimit
            };
          }
          else {
            if (hashObj.isInitiator) { // check to see if this user is the initiator
              if (hashObj.initiatorOdds != 0) { // bad case: initiator odds already set
                responseJSON = {
                  text: "You can't reset your odds!"
                };
              }
              else {
                iOdds = userOdds;
                redisClient.hset(hashObj.hash, 'initiatorOdds', userOdds, redis.print);
              }
            }
            else { // this user is the challenged
              if (hashObj.challengedOdds != 0) { // bad case: challenged odds already set
                responseJSON = {
                  text: "You can't reset your odds!"
                };
              }
              else {
                cOdds = userOdds;
                redisClient.hset(hashObj.hash, 'challengedOdds', userOdds, redis.print);
              }
            }
            if (iOdds != 0 && cOdds != 0) { // both users in challenge have committed odds, respond with result
              redisClient.del(hashObj.hash);
              responseJSON = {
                text: "Odds entered successfully",
              };
              sBot.chat.postMessage({
                channel: req.body.channel_id,
                text: "Both parties have submitted their odds!  <@" + hashObj.initiatorID + "> has entered " + iOdds + ", and <@" + hashObj.challengedID + "> has entered " + cOdds + ".  Do with that information what you will...",
              });
            } else { // default response for successful submission of odds
              let opponent = ""; // change the opponent based on who committed this
              if (hashObj.isInitiator) {
                opponent = hashObj.challengedID;
              }
              else {
                opponent = hashObj.initiatorID;
              }
              responseJSON = {
                text: "Odds entered successfully, waiting on <@" + opponent + ">",
              };
            }
          }
        }
      }
    }
    // cancelling an outstanding odds challenge 
    else if (req.body.command === `/cancelodds`) {
      if (!hashObj) { // bad case: this user has no active challenge
        responseJSON = {
          text: "You have no active challenge!"
        };
      }
      else {
        redisClient.del(hashObj.hash);
        responseJSON = {
          text: "Challenge cancelled",
        };
        let opponent = ""; // change the opponent based on who cancelled this
        if (hashObj.isInitiator) {
          opponent = hashObj.challengedID;
        }
        else {
          opponent = hashObj.initiatorID;
        }
        sBot.chat.postEphemeral({
          channel: req.body.channel_id,
          text: "An odds challenge you were tied to has been cancelled",
          user: opponent,
        });
      }
    }
    // Default case of an unknown command, shouldn't be accessible
    else {
      responseJSON = {
        text: "Command not accounted for in the app",
      };
    }
  }).catch(err => { // errors from the promise are caught here
    console.log(err);
    responseJSON = {
      text: "Error scanning the odds db"
    };
  }).finally(() => { // send the final json back to the user
    console.log("JSON being returned to user: " + JSON.stringify(responseJSON));
    res.json(responseJSON);
  });
}

// helper function for scanning in the db that the redis client is attached to
const redisScanHelper = async () => {
  let cursor = 0; // iterator value for the scan function
  let hashes = []; // to be filled with hashes and sent back when all promises relating to this are fulfilled
  do {
    const scanReturn = await redisClient.scan(cursor); // wait for the scan's results before proceeding with this loop
    console.log(JSON.stringify(scanReturn));
    cursor = scanReturn[0]; // scan returns a size 2 array, element 1 is the next cursor position
    console.log('New cursor: ' + cursor);
    const newHashes = scanReturn[1]; // element 2 of scan array is a subarray of keys(in this case hashes) which we will update our local array with
    hashes = [...hashes, ...newHashes];
    console.log('New list of hashes: ' + hashes);
  } while (cursor && cursor != 0); // when a scan returns a cursor of 0, it means it's finished scanning the db
  return Promise.all(hashes).catch((err) => { // only return when all async hash updates in the above loop have come back, and catch any errors
    console.log('error in redisScanHelper', err);
    return Promise.resolve([]);
  });
};
// helper function used to see if there's a match between a passed id and any hashes from a redis DB
let redisHashGetAllHelper = async (id) => {
  let matchHash = null; // filled with a hash that contains the passed id if one is found
  let initiatorFlag = null; // flag var to specify if the passed id is the initiator or not
  let hashObj = null; // Promise obj that'll be filled with data if all else goes through properly
  const hashes = await redisScanHelper(); // wait for the helper function to finish running to properly fill this var, then proceed
  hashes.forEach((hash) => { // loop through hashes returned to find an id match and determine if it's the initiator
    const involvedParties = hash.split(`\|`);
    for (let i = 0; i < 2; i++) {
      if (involvedParties[i] === id) { // match found, assign vars accordingly
        matchHash = hash;
        if (i == 0)
          initiatorFlag = true;
        else
          initiatorFlag = false;
        break;
      }
    }
  });
  if (matchHash) {
    const hashInfo = await redisClient.hgetall(matchHash); // get all pertinent info from the db to fill in the hashObj
    console.log(hashInfo);
    hashObj = {
      hash: matchHash,
      initiatorID: matchHash.split(`\|`)[0],
      challengedID: matchHash.split(`\|`)[1],
      upperLimit: hashInfo.upperLimit,
      initiatorOdds: hashInfo.initiatorOdds,
      challengedOdds: hashInfo.challengedOdds,
      isInitiator: initiatorFlag,
    };
  }
  return hashObj;
};