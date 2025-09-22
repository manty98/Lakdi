// server/gameLogic.js
// Core Lakdi rules: setup, turns, piles, timer rule, lakdi call, scoring.

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["♠","♥","♦","♣"];

const RANK_VALUE = (r) => {
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return Number(r);
};

function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  shuffle(deck);
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

class LakdiGame {
  constructor(roomId, opts = {}) {
    this.roomId = roomId;
    this.handSize = opts.handSize || 5;
    this.turnSeconds = opts.turnSeconds || 25;

    this.players = []; // { id, name, hand, connected }
    this.hostId = null;

    this.stock = [];
    this.immediateDiscard = [];
    this.pastDiscard = [];

    this.started = false;
    this.declared = false;
    this.firstCutBy = null;

    this.activeIdx = -1;
    this.turnDeadlineMs = null;
    this._timerRef = null;
    this._onTimerExpireCb = null;
  }

  addPlayer(id, name, connected = true) {
    if (this.started) return { ok: false, err: "Game already started" };
    if (this.players.find(p => p.id === id)) return { ok: true };
    this.players.push({ id, name: name || `Player-${this.players.length + 1}`, hand: [], connected });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  markDisconnected(id) {
    const p = this.players.find(x => x.id === id);
    if (p) p.connected = false;
  }

  start(onTimerExpireCb) {
    if (this.started) return { ok: true };
    if (this.players.length < 2) return { ok: false, err: "Need at least 2 players" };
    this._onTimerExpireCb = onTimerExpireCb;

    this.stock = makeDeck();
    // Deal
    for (let i = 0; i < this.handSize; i++) {
      for (const p of this.players) p.hand.push(this.stock.pop());
    }
    this.immediateDiscard = [];
    this.pastDiscard = [];
    this.declared = false;
    this.firstCutBy = null;
    this.started = true;
    this.activeIdx = 0;
    this._startTurnTimer();
    return { ok: true };
  }

  /* ------------------------------ Turn/Timer ------------------------------ */

  _startTurnTimer() {
    this._clearTimer();
    this.turnDeadlineMs = Date.now() + this.turnSeconds * 1000;
    this._timerRef = setTimeout(() => this._onTimerExpire(), this.turnSeconds * 1000 + 25);
  }
  _clearTimer() {
    if (this._timerRef) clearTimeout(this._timerRef);
    this._timerRef = null;
  }
  _nextPlayer() {
    this.activeIdx = (this.activeIdx + 1) % this.players.length;
    this._startTurnTimer();
  }
  _isPlayersTurn(id) {
    return this.players[this.activeIdx]?.id === id;
  }

  _onTimerExpire() {
    if (!this.started || this.declared) return;
    const p = this.players[this.activeIdx];
    // Timer Rule:
    if (p.hand.length > 0) {
      // auto-discard highest rank single card
      let bestIdx = 0, bestVal = -1;
      for (let i = 0; i < p.hand.length; i++) {
        const v = RANK_VALUE(p.hand[i].r);
        if (v > bestVal) { bestVal = v; bestIdx = i; }
      }
      const card = p.hand.splice(bestIdx, 1)[0];
      this.immediateDiscard = [card];
      // auto-draw from stock if possible
      if (this.stock.length > 0) {
        p.hand.push(this.stock.pop());
      }
      // transfer immediate -> past
      this.pastDiscard = this.immediateDiscard;
      this.immediateDiscard = [];
    } else {
      // no cards, auto-draw from stock if possible
      if (this.stock.length > 0) p.hand.push(this.stock.pop());
    }
    this._nextPlayer();
    if (typeof this._onTimerExpireCb === "function") this._onTimerExpireCb();
  }

  /* -------------------------------- Actions ------------------------------- */

  discard(playerId, handIndices) {
    if (!this._isPlayersTurn(playerId)) return { ok: false, err: "Not your turn" };
    if (this.declared) return { ok: false, err: "Already declared" };

    const p = this.players[this.activeIdx];
    if (!Array.isArray(handIndices) || handIndices.length < 1 || handIndices.length > 3) {
      return { ok: false, err: "Select 1–3 cards" };
    }
    const sorted = [...handIndices].sort((a, b) => b - a);
    const picked = [];
    for (const idx of sorted) {
      if (idx < 0 || idx >= p.hand.length) return { ok: false, err: "Bad index" };
      picked.unshift(p.hand[idx]);
    }
    const r0 = picked[0].r;
    if (!picked.every(c => c.r === r0)) return { ok: false, err: "Must be same rank" };

    for (const idx of sorted) p.hand.splice(idx, 1);
    this.immediateDiscard = picked;
    return { ok: true };
  }

  draw(playerId, source) {
    if (!this._isPlayersTurn(playerId)) return { ok: false, err: "Not your turn" };
    if (this.declared) return { ok: false, err: "Already declared" };

    const p = this.players[this.activeIdx];
    if (source === "stock") {
      if (this.stock.length === 0) return { ok: false, err: "Stock empty" };
      p.hand.push(this.stock.pop());
    } else if (source === "past") {
      if (this.pastDiscard.length === 0) return { ok: false, err: "Past empty" };
      // Draw the top/last of past
      p.hand.push(this.pastDiscard.pop());
    } else {
      return { ok: false, err: "Unknown draw source" };
    }

    if (this.immediateDiscard.length > 0) {
      this.pastDiscard = this.immediateDiscard;
      this.immediateDiscard = [];
    }

    this._nextPlayer();
    return { ok: true };
  }

  callLakdi(playerId) {
    if (!this._isPlayersTurn(playerId)) return { ok: false, err: "Not your turn" };
    if (this.declared) return { ok: false, err: "Already declared" };

    this.declared = true;
    if (!this.firstCutBy) this.firstCutBy = playerId;

    const scores = this._computeScores(playerId);
    this._clearTimer();
    return { ok: true, scores };
  }

  _computeScores(callerId) {
    const res = {};
    for (const p of this.players) {
      res[p.id] = {
        name: p.name,
        points: p.hand.reduce((acc, c) => acc + RANK_VALUE(c.r), 0),
      };
    }
    // Optional invalid Lakdi +50 if caller not lowest
    const sorted = Object.entries(res).sort((a, b) => a[1].points - b[1].points);
    const lowest = sorted[0];
    if (res[callerId] && lowest && res[callerId].points !== lowest[1].points) {
      res[callerId].points += 50;
    }
    return res;
  }

  /* ------------------------------- State API ------------------------------ */

  getPublicState() {
    return {
      roomId: this.roomId,
      players: this.players.map(p => ({ id: p.id, name: p.name, handCount: p.hand.length, connected: p.connected })),
      you: null,
      stockCount: this.stock.length,
      immediateDiscard: structuredClone(this.immediateDiscard),
      pastDiscard: structuredClone(this.pastDiscard),
      activePlayerId: this.players[this.activeIdx]?.id ?? null,
      turnDeadlineMs: this.turnDeadlineMs,
      declared: this.declared,
      firstCutBy: this.firstCutBy,
      started: this.started,
      hostId: this.hostId,
    };
  }

  getPrivateHand(id) {
    const p = this.players.find(x => x.id === id);
    return p ? structuredClone(p.hand) : [];
  }
}

module.exports = { LakdiGame, RANK_VALUE };
