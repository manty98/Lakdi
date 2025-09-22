// server/botLogic.js
// Simple bots: easy / medium / hard heuristics.
// Each bot must implement { id, difficulty, takeTurn(game, emit) }.
// emit(event, payload) mirrors client socket actions.

const { RANK_VALUE } = require("./gameLogic");

function groupByRank(hand) {
  const map = new Map();
  for (let i = 0; i < hand.length; i++) {
    const r = hand[i].r;
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(i);
  }
  return map;
}

function chooseDiscardSet(hand, difficulty) {
  const groups = groupByRank(hand);
  let best = null;

  // Prefer triples > pairs > singles; for singles pick highest (timer-rule aligned)
  for (const [rank, idxs] of groups) {
    if (!best || idxs.length > best.idxs.length ||
        (idxs.length === best.idxs.length && RANK_VALUE(rank) > RANK_VALUE(best.rank))) {
      best = { rank, idxs };
    }
  }

  if (!best) return null;
  if (difficulty === "easy") {
    // easy: discard single highest card
    const highest = best.idxs.slice().sort((a, b) => RANK_VALUE(hand[b].r) - RANK_VALUE(hand[a].r))[0];
    return [highest];
  }
  if (difficulty === "medium") {
    // medium: discard up to 2 of best rank
    return best.idxs.slice(0, Math.min(2, best.idxs.length));
  }
  // hard: discard up to 3 of best rank
  return best.idxs.slice(0, Math.min(3, best.idxs.length));
}

function decision(game, botId, difficulty) {
  // If drawing past helps make/extend a set, prefer past; else stock.
  const me = game.players[game.activeIdx];
  if (!me || me.id !== botId) return null;

  // Heuristic Lakdi: If total <= threshold, call.
  const sum = me.hand.reduce((a, c) => a + RANK_VALUE(c.r), 0);
  const lakdiThreshold = difficulty === "hard" ? 10 : difficulty === "medium" ? 7 : 5; // smaller = braver
  if (sum <= lakdiThreshold) return { type: "lakdi" };

  // Discard choice
  const disc = chooseDiscardSet(me.hand, difficulty);
  if (!disc || disc.length === 0) {
    // no discard (shouldn't happen), just draw stock
    return { type: "draw", source: "stock" };
  }

  // After discard, prefer drawing from past if matches discarded rank
  const discardedRank = me.hand[disc[0]]?.r;
  const pastTop = game.pastDiscard.at(-1);
  const preferPast = pastTop && (pastTop.r === discardedRank);

  return { type: "discard+draw", handIndices: disc, source: preferPast ? "past" : "stock" };
}

function makeBot(botId, difficulty = "easy") {
  return {
    id: botId,
    difficulty,
    takeTurn(game, emit) {
      const d = decision(game, botId, difficulty);
      if (!d) return;
      if (d.type === "lakdi") {
        emit("lakdi", { roomId: game.roomId });
        return;
      }
      if (d.type === "draw") {
        emit("draw", { roomId: game.roomId, source: d.source });
        return;
      }
      if (d.type === "discard+draw") {
        emit("discard", { roomId: game.roomId, handIndices: d.handIndices });
        // tiny extra wait so UI can show discard before draw
        setTimeout(() => emit("draw", { roomId: game.roomId, source: d.source }), 200);
      }
    }
  };
}

module.exports = { makeBot };
