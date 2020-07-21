// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require(`dotenv`).config();

const express = require(`express`); // significantly simplifies app routing
const bodyParser = require(`body-parser`); // parses request bodies
const redis = require(`ioredis`); // allows us to set up a redis client locally

//const request = require("request");

// client that will connect to the redis db and handle interactions between slack and the db
let redisClient = new redis({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOSTNAME,
  password: process.env.REDIS_PASSWORD,
});

// Creates express app
const app = express();
// The port used for Express server
const PORT = 3000;
// Starts server
app.listen(process.env.PORT || PORT, function () {
  console.log('Bot is listening on port ' + PORT);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Attach the slash command handler
app.post('/', bodyParser.urlencoded({ extended: false }), slackSlashCommand);

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  let responseJSON = {
    text: "Oopsie doopsie, something went wrong on my end!",
  }; // obj to be filled with data based on which case is met by the user's request and then sent back at the end
  let responseSet = false;
  redisHashGetAllHelper(req.body.user_id).then(hashObj => { // all commands need to check hashes in the db at some point, so get all of those and then proceed
    console.log("Here's the returned hashObj from redisHashGetAllHelper: " + JSON.stringify(hashObj));
    // odds initiation
    if (req.body.command === '/odds') {
      if (req.body.text.includes("<@")) { // check for id
        let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; // grab the id of the challenged
        if (hashObj) { // check for active challenge with this user
          if (!responseSet) {
            responseJSON = {
              text: "People can only have one outstanding challenge at a time, so you or they must resolve it first or cancel with /cancelodds",
            };
            responseSet = true;
          }
        }
        else if (req.body.user_id === challengedID) {  // bad case: trying to challenge themselves
          if (!responseSet) {
            responseJSON = {
              text: "You can't challenge yourself numbnuts!",
            };
            responseSet = true;
          }
        }
        else { // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
          let initiatorChallengedHash = req.body.user_id + "|" + challengedID; // challenge hash always puts initiator to the left and challenged to the right
          redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
          redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
          redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
          if (!responseSet) {
            responseJSON = {
              response_type: "in_channel",
              text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
            };
            responseSet = true;
          }
        }
      }
      else { // bad case: no user specified
        if (!responseSet) {
          responseJSON = {
            text: "You need to specify who you're challenging!"
          };
          responseSet = true;
        }
      }
    }
    // setting upper limit of odds
    else if (req.body.command === '/setodds') {
      if (hashObj) { // check to make sure this user has an active challenge
        if (!hashObj.isInitiator) { // check to make sure this user is being challenged
          if (hashObj.upperLimit == 0) { // check to make sure upperLimit hasn't already been set
            let uL = null;
            if (req.body.text.match(`[0-9]+`))
              uL = req.body.text.match(`[0-9]+`)[0];
            if (uL && uL > 1 && uL < Number.MAX_VALUE) { // check that there's a valid number in the text
              redisClient.hset(hashObj.hash, 'upperLimit', uL, redis.print);
              if (!responseSet) {
                responseJSON = {
                  response_type: "in_channel",
                  text: "<@" + req.body.user_id + ">, Has set their upper limit to " + uL + ", now both they and the challenge initator must enter a value betweeen 1 and that number with /commitodds",
                };
                responseSet = true;
              }
            } else { // bad case: no valid iteger in text
              if (!responseSet) {
                responseJSON = {
                  text: "You need enter a valid integer!"
                };
                responseSet = true;
              }
            }
          }
          else { // bad case: upper limit already set
            if (!responseSet) {
              responseJSON = {
                text: "You can't reset the upper limit!"
              };
              responseSet = true;
            }
          }
        }
        else { // bad case: this user is the initiator
          if (!responseSet) {
            responseJSON = {
              text: "You are not the challenged, and therefor cannot set the odds!"
            };
            responseSet = true;
          }
        }
      }
      else { // bad case: this user has no active challenge
        if (!responseSet) {
          responseJSON = {
            text: "You have no active challenge!"
          };
          responseSet = true;
        }
      }
    }
    // commiting an inividual's odds number
    else if (req.body.command === '/commitodds') {
      if (hashObj) {
        let iOdds = hashObj.initiatorOdds;
        let cOdds = hashObj.challengedOdds;
        let userOdds = null;
        if (hashObj.upperLimit == 0) { // bad case: upper limit not set
          if (!responseSet) {
            responseJSON = {
              text: "Upper limit hasn't been set yet!"
            };
            responseSet = true;
          }
        }
        else {
          userOdds = req.body.text.match(`[0-9]+`)[0];
          if (!userOdds || userOdds < 1 || userOdds > hashObj.upperLimit) { // bad case: no valid integer in text
            if (!responseSet) {
              responseJSON = {
                text: "You need enter a valid integer!"
              };
              responseSet = true;
            }
          }
          else {
            if (hashObj.isInitiator) { // check to see if this user is the initiator
              if (hashObj.initiatorOdds == 0) { // check for default odds value
                if (userOdds) {
                  iOdds = userOdds;
                  redisClient.hset(hashObj.hash, 'initiatorOdds', userOdds, redis.print);
                }
              }
              else { // bad case: initiator odds already set
                if (!responseSet) {
                  responseJSON = {
                    text: "You can't reset your odds!"
                  };
                  responseSet = true;
                }
              }
            }
            else { // this user is the challenged
              if (hashObj.challengedOdds == 0) { // check for default odds value
                if (userOdds) {
                  cOdds = userOdds;
                  redisClient.hset(hashObj.hash, 'initiatorOdds', userOdds, redis.print);
                }
              }
              else { // bad case: challenged odds already set
                if (!responseSet) {
                  responseJSON = {
                    text: "You can't reset your odds!"
                  };
                  responseSet = true;
                }
              }
            }
            if (iOdds != 0 && cOdds != 0) { // both users in challenge have committed odds, respond with result
              redisClient.del(hashObj.hash);
              if (!responseSet) {
                responseJSON = {
                  response_type: "in_channel",
                  text: "Both parties have submitted their odds!  <@" + hashObj.initiatorID + "> has entered " + iOdds + ", and <@" + hashObj.challengedID + "> has entered " + cOdds + ".  Do with that information what you will...",
                };
                responseSet = true;
              }
            } else { // default response for successful submission of odds
              if (!responseSet) {
                let opponent = ""; // change the opponent based on who committed this
                if(hashObj.isInitiator){
                  opponent = hashObj.challengedID;
                }
                else {
                  opponent = hashObj.initiatorID;
                }
                responseJSON = {
                  response_type: "in_channel",
                  text: "Odds entered successfully, waiting on <@" + opponent + ">",
                };
                responseSet = true;
              }
            }
          }
        }
      }
      else { // bad case: this user has no active challenge
        if (!responseSet) {
          responseJSON = {
            text: "You have no active challenge!"
          };
          responseSet = true;
        }
      }
    }
    // cancelling an outstanding odds challenge 
    else if (req.body.command === `/cancelodds`) {
      if (hashObj) {
        redisClient.del(hashObj.hash);
        if (!responseSet) {
          responseJSON = {
            response_type: `in_channel`,
            text: "<@" + req.body.user_id + "> has cancelled their challenge.",
          };
          responseSet = true;
        }
      }
      else { // bad case: this user has no active challenge
        if (!responseSet) {
          responseJSON = {
            text: "You have no active challenge!"
          };
          responseSet = true;
        }
      }
    }
    else { // case of bad command/default case, should be unreachable tm
      if (!responseSet) {
        responseJSON = {
          text: "Bad command!  How did you get here?",
        };
        responseSet = true;
      }
    }
  }).catch(err => { // errors from the db scan promise are caught here
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
    const scanReturn = await redisClient.scan(cursor);
    console.log(JSON.stringify(scanReturn));
    cursor = scanReturn[0];
    console.log('New cursor: ' + cursor);
    const newHashes = scanReturn[1];
    hashes = [...hashes, ...newHashes];
    console.log('New list of hashes: ' + hashes);
  } while (cursor && cursor != 0);
  return Promise.all(hashes).catch((err) => {
    console.log('error in redisScanHelper', err);
    return Promise.resolve([]);
  });
};
// helper function used to see if there's a match between a passed id and any hashes from a redis DB
let redisHashGetAllHelper = async (id) => {
  let matchHash = null; // filled with a hash that contains the passed id if one is found
  let initiatorFlag = null; // flag var to specify if the passed id is the initiator or not
  let hashObj = null; // Promise obj that'll be filled with data if all else goes through properly
  const hashes = await redisScanHelper(); // removed catch since redisScanHelper logs for us
  hashes.forEach((hash) => {
    // loop through hashes returned to find an id match and determine if it's the initiator
    const involvedParties = hash.split(`\|`);
    for (let i = 0; i < 2; i++) {
      if (involvedParties[i] === id) {
        matchHash = hash;
        if ((i = 0)) initiatorFlag = true;
        else initiatorFlag = false;
        break;
      }
    }
  });
  if (matchHash) {
    const hashInfo = await redisClient.hgetall(matchHash); // returns array with BOTH the names of the fields and their values, hence only using the odd numbered indexes
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