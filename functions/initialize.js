const admin = require('firebase-admin');
const crypto = require('crypto');
const fetch = require("fetch").fetchUrl;
const { decode, encode } = require('./transaction');
const moment = require('moment');
const vstruct = require('varstruct');
const base32 = require('base32.js');

const database = admin.database();
let MAX_BLOCK = 1;
let index = 1;
const BANDWIDTH_PERIOD = 86400;
const MAX_BLOCK_SIZE = 22020096;
const RESERVE_RATIO = 1;
const MAX_CELLULOSE = Number.MAX_SAFE_INTEGER;
const NETWORK_BANDWIDTH = RESERVE_RATIO * MAX_BLOCK_SIZE * BANDWIDTH_PERIOD;

const Followings = vstruct([
    { name: 'addresses', type: vstruct.VarArray(vstruct.UInt16BE, vstruct.Buffer(35)) },
]);
const PlainTextContent = vstruct([
    { name: 'type', type: vstruct.UInt8 },
    { name: 'text', type: vstruct.VarString(vstruct.UInt16BE) },
]);
function reloadBlock() {
    if (index === parseInt(MAX_BLOCK)) {
        fetch('https://komodo.forest.network/abci_info', (error, meta, body) => {
            const resp = JSON.parse(body.toString());
            MAX_BLOCK = resp.result.response.last_block_height;
            if (index !== parseInt(MAX_BLOCK)) {
                loadBlock(++index);
                const ref = database.ref('/');
                ref.once('value', snap => {
                    const list = snap.val().users;
                    for (let i in list)
                        list[i].energy = increaseEnergy(list[i]);
                    ref.update({
                        users: list,
                    })
                })
            }
        });
    }
}
function initialize() {
    const http = require('http');
    setInterval(() => http.get('http://forest-network-dack.herokuapp.com/'), 300000);
    const server = database.ref('/server');
    console.log('Getting data');
    server.once('value', snap => {
        if (snap.exists()) {
            index = snap.val().block + 1;
            fetch('https://komodo.forest.network/abci_info', (error, meta, body) => {
                const resp = JSON.parse(body.toString());
                MAX_BLOCK = resp.result.response.last_block_height;
                loadBlock(index);
                setInterval(() => reloadBlock(), 60000);
                console.log('Loaded block');
            });
        }
    });
}

function checkLastBlock(i) {
    if (i < MAX_BLOCK) {
        const server = database.ref('/server');
        return server.update({
            block: parseInt(i),
        }).then(() => loadBlock(++index));
    }
    return true;
}

function loadBlock(i) {
    // if (i % 100 === 0)
    // console.log('loading ', i);
    fetch('https://komodo.forest.network/block?height=' + i, (error, meta, body) => {
        const resp = JSON.parse(body.toString());
        const num_txs = resp.result.block_meta.header.num_txs;
        const server = database.ref('/server');
        const time = resp.result.block_meta.header.time;
        if (num_txs !== "0") {
            const txs = resp.result.block.data.txs;
            txs.map(etx => {
                const tx = decode(Buffer.from(etx, 'base64'));
                const hashtx = crypto.createHash('sha256').update(encode(tx)).digest().toString('hex').toUpperCase();
                loadTx(hashtx, time);
                return etx;
            });
        }
        else
            server.update({
                block: parseInt(i),
            }).then(() => checkLastBlock(index));
    });
}
function loadTx(hashTx, time) {
    return fetch('https://komodo.forest.network/tx?hash=0x' + hashTx, (error, meta, body) => {
        const resp = JSON.parse(body.toString());
        const success = resp.result.tx_result.tags;
        if (success) {
            const txSize = resp.result.tx.length;
            const tx = decode(Buffer.from(resp.result.tx, 'base64'));
            switch (tx.operation) {
                case 'create_account': {
                    createAccount(tx, time, txSize);
                    break;
                }
                case 'payment': {
                    payment(tx, time, txSize);
                    break;
                }
                case 'update_account': {
                    updateAccount(tx, time, txSize);
                    break;
                }
                case 'post': {
                    try {
                        tx.params.content = PlainTextContent.decode(tx.params.content);
                    } catch (e) { tx.params.content = undefined };
                    post(tx, time, txSize);
                    break;
                }
                default: {
                    checkLastBlock(index);
                    break;
                }
            }
        }
    })
}

function createAccount(tx, lastTx, txSize) {
    const address = database.ref('/users/' + tx.params.address);
    const account = database.ref('/users/' + tx.account);
    Promise.all([address.set({
        balance: 0,
        energy: 0,
        bandwidth: 0,
        sequence: 0,
    }),
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            account.update({
                sequence: sequence + 1,
                lastTx,
                bandwidth,
                energy: bandwidthLimit - bandwidth,
            })
        }
    })]).then(() => {
        return checkLastBlock(index);
    }).catch(e => console.log(e));
}

function payment(tx, lastTx, txSize) {
    const address = database.ref('/users/' + tx.params.address);
    const account = database.ref('/users/' + tx.account);
    Promise.all([address.once('value', snap => {
        if (snap.exists()) {
            const balance = snap.val().balance;
            const energy = snap.val().energy;
            const newenergy = tx.params.amount / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            address.update({
                balance: balance + tx.params.amount,
                energy: energy + newenergy,
            });
        }
    }),
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            const balance = snap.val().balance;
            const bandwidthLimit = (balance - tx.params.amount) / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            account.update({
                sequence: sequence + 1,
                balance: balance - tx.params.amount,
                lastTx,
                bandwidth,
                energy: bandwidthLimit - bandwidth,
            });
        }
    })]).then(() => {
        return checkLastBlock(index);
    }).catch(e => console.log(e));
}

function updateAccount(tx, lastTx, txSize) {
    const account = database.ref('/users/' + tx.account);
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            switch (tx.params.key) {
                case 'name': {
                    const name = Buffer.from(tx.params.value).toString('utf-8');
                    return account.update({
                        sequence: sequence + 1,
                        name,
                        lastTx,
                        bandwidth,
                        energy: bandwidthLimit - bandwidth,
                    }).then(() => {
                        return checkLastBlock(index);
                    }).catch(e => console.log(e));
                }
                case 'picture': {
                    const picture = Buffer.from(tx.params.value).toString('base64');
                    return account.update({
                        sequence: sequence + 1,
                        picture,
                        lastTx,
                        bandwidth,
                        energy: bandwidthLimit - bandwidth,
                    }).then(() => {
                        return checkLastBlock(index);
                    }).catch(e => console.log(e));
                }
                case 'followings': {
                    try {
                        const followings = Followings.decode(Buffer.from(tx.params.value));
                        followings.addresses = followings.addresses.map(address => {
                            const encaddr = base32.encode(address);
                            return encaddr;
                        });
                        return account.update({
                            followings: followings.addresses,
                        }).then(() => {
                            return checkLastBlock(index);
                        }).catch(e => console.log(e));
                    } catch (e) { return checkLastBlock(index) }
                }
                default: {
                    return account.update({
                        sequence: sequence + 1,
                    }).then(() => {
                        return checkLastBlock(index);
                    }).catch(e => console.log(e));
                }
            }
        }
        else checkLastBlock(index);
    });
}

function post(tx, lastTx, txSize) {
    const account = database.ref('/users/' + tx.account);
    const content = tx.params.content;
    account.once('value', snap => {
        if (snap.exists() && content) {
            const sequence = snap.val().sequence;
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            let posts = snap.val().posts;
            if (posts)
                posts.push(content.text);
            else
                posts = [content.text];
            return account.update({
                sequence: sequence + 1,
                posts: posts,
                bandwidth,
                lastTx,
                energy: bandwidthLimit - bandwidth,
            }).then(() => {
                return checkLastBlock(index);
            }).catch(e => console.log(e));
        }
        else
            checkLastBlock(index);
    });
}

function calculateBandwidth(account, time, txSize) {
    const bandwidthTime = account.lastTx;
    const bandwidth = account.bandwidth;
    const diff = bandwidthTime ? moment(time).unix() - moment(bandwidthTime).unix() : BANDWIDTH_PERIOD;
    return Math.ceil(Math.max(0, (BANDWIDTH_PERIOD - diff) / BANDWIDTH_PERIOD) * bandwidth + txSize);
}

function increaseEnergy(account) {
    const bandwidthTime = account.lastTx;
    const energy = account.energy;
    const bandwidthLimit = account.balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
    if (energy >= bandwidthLimit)
        return energy;
    const diff = moment().unix() - moment(bandwidthTime).unix()
    if (diff >= BANDWIDTH_PERIOD)
        return bandwidthLimit;
    return energy + (bandwidthLimit - energy) / BANDWIDTH_PERIOD * diff;
}

module.exports = {
    initialize
};