const admin = require('firebase-admin');
const crypto = require('crypto');
const fetch = require("fetch").fetchUrl;
const serviceAccount = require('./config.json');
const { decode, encode } = require('./transaction');
const moment = require('moment');
const vstruct = require('varstruct');
const base32 = require('base32.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://forest-network-dack.firebaseio.com",
});
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
const ReactContent = vstruct([
    { name: 'type', type: vstruct.UInt8 },
    { name: 'reaction', type: vstruct.UInt8 },
]);
function reloadBlock() {
    if (index === parseInt(MAX_BLOCK)) {
        fetch('https://fox.forest.network/abci_info', (error, meta, body) => {
            try {
                const resp = JSON.parse(body.toString());
                MAX_BLOCK = resp.result.response.last_block_height;
                if (index !== parseInt(MAX_BLOCK)) {
                    loadBlock(++index);
                    const ref = database.ref('/');
                    ref.once('value', snap => {
                        const list = snap.val().users;
                        const now = moment();
                        for (let i in list)
                            list[i].energy = increaseEnergy(list[i], now);
                        ref.update({
                            users: list,
                        })
                    })
                }
            } catch (e) {
                console.log(e);
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
            getabci_info();
        }
    });
}

function getabci_info() {
    fetch('https://fox.forest.network/abci_info', (error, meta, body) => {
        try {
            const resp = JSON.parse(body.toString());
            MAX_BLOCK = resp.result.response.last_block_height;
            loadBlock(index);
            setInterval(() => reloadBlock(), 60000);
            console.log('Loaded block');
        } catch (e) {
            getabci_info();
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
    fetch('https://fox.forest.network/block?height=' + i, (error, meta, body) => {
        try {
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
        } catch (e) {
            console.log(e);
            loadBlock(index);
        }
    });
}
function loadTx(hashTx, time) {
    return fetch('https://fox.forest.network/tx?hash=0x' + hashTx, (error, meta, body) => {
        try {
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
                            if (tx.params.content.type !== 1)
                                tx.params.content = undefined;
                        } catch (e) { tx.params.content = undefined };
                        post(hashTx, tx, time, txSize);
                        break;
                    }
                    case 'interact': {
                        try {
                            tx.params.content = PlainTextContent.decode(tx.params.content);
                            if (tx.params.content.type !== 1)
                                tx.params.content = undefined;
                        } catch (e) {
                            try {
                                tx.params.content = ReactContent.decode(tx.params.content);
                                if (tx.params.content.type !== 2)
                                    tx.params.content = undefined;
                            }
                            catch (e) { tx.params.content = undefined };
                        };
                        interact(tx, time, txSize);
                        break;
                    }
                    default: {
                        checkLastBlock(index);
                        break;
                    }
                }
            }
        } catch (e) {
            console.log(e);
            loadTx(hashTx, time)
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
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            account.update({
                sequence: tx.sequence,
                lastTx,
                bandwidth,
                energy: bandwidthLimit - bandwidth,
            })
        }
    })]).then(() => checkLastBlock(index)).catch(e => console.log(e));
}

function payment(tx, lastTx, txSize) {
    const address = database.ref('/users/' + tx.params.address);
    const account = database.ref('/users/' + tx.account);
    Promise.all([address.once('value', snap => {
        if (snap.exists()) {
            const balance = snap.val().balance;
            const energy = snap.val().energy;
            let payment = snap.val().payment;
            if (payment)
                payment.push({
                    type: 'receive',
                    amount: tx.params.amount,
                    address: tx.account,
                })
            else payment = [{
                type: 'receive',
                amount: tx.params.amount,
                address: tx.account,
            }];
            const newenergy = tx.params.amount / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            address.update({
                balance: balance + tx.params.amount,
                energy: energy + newenergy,
                payment,
            });
        }
    }),
    account.once('value', snap => {
        if (snap.exists()) {
            const balance = snap.val().balance;
            const bandwidthLimit = (balance - tx.params.amount) / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            let payment = snap.val().payment;
            if (payment)
                payment.push({
                    type: 'send',
                    amount: tx.params.amount,
                    address: tx.account,
                })
            else payment = [{
                type: 'send',
                amount: tx.params.amount,
                address: tx.account,
            }];
            account.update({
                sequence: tx.sequence,
                balance: balance - tx.params.amount,
                lastTx,
                bandwidth,
                payment,
                energy: bandwidthLimit - bandwidth,
            });
        }
    })]).then(() => checkLastBlock(index)).catch(e => console.log(e));
}

function updateAccount(tx, lastTx, txSize) {
    const account = database.ref('/users/' + tx.account);
    account.once('value', snap => {
        if (snap.exists()) {
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            switch (tx.params.key) {
                case 'name': {
                    const name = Buffer.from(tx.params.value).toString('utf-8');
                    return account.update({
                        sequence: tx.sequence,
                        name,
                        lastTx,
                        bandwidth,
                        energy: bandwidthLimit - bandwidth,
                    }).then(() => checkLastBlock(index)).catch(e => console.log(e));
                }
                case 'picture': {
                    const picture = Buffer.from(tx.params.value).toString('base64');
                    return account.update({
                        sequence: tx.sequence,
                        picture,
                        lastTx,
                        bandwidth,
                        energy: bandwidthLimit - bandwidth,
                    }).then(() => checkLastBlock(index)).catch(e => console.log(e));
                }
                case 'followings': {
                    try {
                        const followings = Followings.decode(Buffer.from(tx.params.value));
                        followings.addresses = followings.addresses.map(address => {
                            const encaddr = base32.encode(address);
                            return encaddr;
                        });
                        return account.update({
                            sequence: tx.sequence,
                            followings: followings.addresses,
                            lastTx,
                            bandwidth,
                            energy: bandwidthLimit - bandwidth,
                        }).then(() => checkLastBlock(index)).catch(e => console.log(e));
                    } catch (e) {
                        return account.update({
                            sequence: tx.sequence,
                            lastTx,
                            bandwidth,
                            energy: bandwidthLimit - bandwidth,
                        }).then(() => checkLastBlock(index));
                    }
                }
                default: {
                    return account.update({
                        sequence: tx.sequence,
                        lastTx,
                        bandwidth,
                        energy: bandwidthLimit - bandwidth,
                    }).then(() => checkLastBlock(index)).catch(e => console.log(e));
                }
            }
        }
        else
            checkLastBlock(index);
    });
}

function post(hashTx, tx, lastTx, txSize) {
    const account = database.ref('/users/' + tx.account);
    const content = tx.params.content;
    account.once('value', snap => {
        if (snap.exists() && content) {
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            let posts = snap.val().posts;
            if (posts)
                posts.push(hashTx);
            else
                posts = [hashTx];
            const postcontent = database.ref('/posts/' + hashTx);
            postcontent.once('value', snap => {
                if (!snap.exists()) {
                    postcontent.set({
                        content: content.text,
                    });
                }
            });
            return account.update({
                sequence: tx.sequence,
                posts: posts,
                bandwidth,
                lastTx,
                energy: bandwidthLimit - bandwidth,
            }).then(() => checkLastBlock(index)).catch(e => console.log(e));
        }
        else
            if (snap.exists()) {
                const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
                const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
                return account.update({
                    sequence: tx.sequence,
                    bandwidth,
                    lastTx,
                    energy: bandwidthLimit - bandwidth,
                }).then(() => checkLastBlock(index)).catch(e => console.log(e));
            } else
                checkLastBlock(index);
    });
}

function interact(tx, lastTx, txSize) {
    const account = database.ref('/users/' + tx.account);
    const content = tx.params.content;
    account.once('value', snap => {
        if (snap.exists()) {
            const bandwidthLimit = snap.val().balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
            const bandwidth = calculateBandwidth(snap.val(), lastTx, txSize);
            account.update({
                sequence: tx.sequence,
                bandwidth,
                lastTx,
                energy: bandwidthLimit - bandwidth,
            }).then(() => {
                if (content) {
                    switch (content.type) {
                        case 1:
                            const cmt = database.ref('/posts/' + tx.params.object + '/comment/');
                            return cmt.push({ account: tx.account, content: content.text }).then(() => checkLastBlock(index));
                        case 2:
                            const react = database.ref('/posts/' + tx.params.object + '/react/' + tx.account);
                            switch (content.reaction) {
                                case 0:
                                    return react.remove().then(() => checkLastBlock(index));
                                case 1:
                                    return react.set('like').then(() => checkLastBlock(index));
                                case 2:
                                    return react.set('love').then(() => checkLastBlock(index));
                                case 3:
                                    return react.set('haha').then(() => checkLastBlock(index));
                                case 4:
                                    return react.set('wow').then(() => checkLastBlock(index));
                                case 5:
                                    return react.set('sad').then(() => checkLastBlock(index));
                                case 6:
                                    return react.set('angry').then(() => checkLastBlock(index));
                                default: return checkLastBlock(index);
                            }
                        default:
                            return checkLastBlock(index);
                    }
                } else
                    checkLastBlock(index);
            });
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

function increaseEnergy(account, time) {
    const bandwidthTime = account.lastTx;
    const energy = account.energy;
    const bandwidth = account.bandwidth;
    const bandwidthLimit = account.balance / MAX_CELLULOSE * NETWORK_BANDWIDTH;
    if (energy >= bandwidthLimit)
        return energy;
    const diff = moment(time).unix() - moment(bandwidthTime).unix()
    if (diff >= BANDWIDTH_PERIOD)
        return bandwidthLimit;
    return bandwidthLimit - bandwidth * (1 - diff / BANDWIDTH_PERIOD);
}

module.exports = {
    initialize
};