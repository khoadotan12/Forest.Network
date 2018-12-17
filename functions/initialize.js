const admin = require('firebase-admin');
const crypto = require('crypto');
const fetch = require("fetch").fetchUrl;
const { decode, encode } = require('./transaction');
const database = admin.database();
const MAX_BLOCK = 9475;
let index = 1;

function initialize() {
    loadBlock(index);
}

function checkLastBlock(i) {
    if (i < MAX_BLOCK)
        return loadBlock(index++);
    return true;
}

function loadBlock(i) {
    if (i % 100 === 0)
        console.log(i);
    fetch('https://komodo.forest.network/block?height=' + i, (error, meta, body) => {
        const resp = JSON.parse(body.toString());
        const num_txs = resp.result.block_meta.header.num_txs;
        if (num_txs !== "0") {
            const txs = resp.result.block.data.txs;
            txs.map(etx => {
                const tx = decode(Buffer.from(etx, 'base64'));
                const hashtx = crypto.createHash('sha256').update(encode(tx)).digest().toString('hex').toUpperCase();
                loadTx(i, hashtx);
                return etx;
            });
        }
        else
            checkLastBlock(index);
    });
}

function loadTx(i, hashTx) {
    return fetch('https://komodo.forest.network/tx?hash=0x' + hashTx, (error, meta, body) => {
        const resp = JSON.parse(body.toString());
        const success = resp.result.tx_result.tags;
        if (success) {
            const tx = decode(Buffer.from(resp.result.tx, 'base64'));
            switch (tx.operation) {
                case 'create_account': {
                    createAccount(tx);
                    break;
                }
                case 'payment': {
                    payment(tx);
                    break;
                }
                case 'update_account': {
                    updateAccount(tx);
                    break;
                }
                case 'post': {
                    post(hashTx, tx);
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

function createAccount(tx) {
    const address = database.ref('/users/' + tx.params.address);
    const account = database.ref('/users/' + tx.account);
    Promise.all([address.set({
        balance: 0,
        energy: 0,
        sequence: 0,
    }),
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            account.update({
                sequence: sequence + 1,
            })
        }
    })]).then(() => {
        return checkLastBlock(index);
    }).catch(e => console.log(e));
}

function payment(tx) {
    const address = database.ref('/users/' + tx.params.address);
    const account = database.ref('/users/' + tx.account);
    Promise.all([address.once('value', snap => {
        if (snap.exists()) {
            const balance = snap.val().balance;
            address.update({
                balance: balance + tx.params.amount,
            });
        }
    }),
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            const balance2 = snap.val().balance;
            account.update({
                sequence: sequence + 1,
                balance: balance2 - tx.params.amount,
            });
        }
    })]).then(() => {
        return checkLastBlock(index);
    }).catch(e => console.log(e));
}

function updateAccount(tx) {
    const account = database.ref('/users/' + tx.account);
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            switch (tx.params.key) {
                case 'name': {
                    const name = Buffer.from(tx.params.value).toString('utf-8');
                    return account.update({
                        sequence: sequence + 1,
                        name,
                    }).then(() => {
                        return checkLastBlock(index);
                    }).catch(e => console.log(e));
                }
                case 'picture': {
                    const picture = Buffer.from(tx.params.value).toString('base64');
                    return account.update({
                        sequence: sequence + 1,
                        picture,
                    }).then(() => {
                        return checkLastBlock(index);
                    }).catch(e => console.log(e));
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

function post(hashTx, tx) {
    const account = database.ref('/users/' + tx.account);
    const content = Buffer.from(tx.params.content).toString();
    account.once('value', snap => {
        if (snap.exists()) {
            const sequence = snap.val().sequence;
            let posts = snap.val().posts;
            if (posts)
                posts.push({
                    hashTx,
                    content,
                })
            else
                posts = [{
                    hashTx,
                    content,
                }];
            return account.update({
                sequence: sequence + 1,
                posts: posts,
            }).then(() => {
                return checkLastBlock(index);
            }).catch(e => console.log(e));
        }
        else
            checkLastBlock(index);
    });
}

module.exports = {
    initialize
};