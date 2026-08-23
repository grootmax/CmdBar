/**
 * Helper JS module for KDE Plasma CmdBar Plasmoid QML components.
 * Provides command searching, parameter replacement, AI translation trigger,
 * output formatting, and theme mapping.
 */

.pragma library

function fuzzyMatch(query, text) {
  if (!query) return { matched: true, score: 1.0, highlight: text };
  if (!text) return { matched: false, score: 0, highlight: "" };

  var q = query.toLowerCase();
  var t = text.toLowerCase();
  
  if (t.indexOf(q) !== -1) {
    return { matched: true, score: 0.9, highlight: text };
  }

  var qIdx = 0;
  var matchedIndices = [];
  for (var i = 0; i < text.length; i++) {
    if (t[i] === q[qIdx]) {
      matchedIndices.push(i);
      qIdx++;
      if (qIdx === q.length) break;
    }
  }

  if (qIdx === q.length) {
    var score = q.length / (matchedIndices[matchedIndices.length - 1] - matchedIndices[0] + 1);
    return { matched: true, score: score, highlight: text };
  }

  return { matched: false, score: 0, highlight: text };
}

function hasPlaceholders(template) {
  if (!template) return false;
  return (
    /<[a-zA-Z0-9_-]+>/.test(template) ||
    /\{\{[a-zA-Z0-9_-]+\}\}/.test(template) ||
    /\{[a-zA-Z0-9_-]+\}/.test(template)
  );
}

function substitutePlaceholders(template, value) {
  if (!template) return "";
  var val = value !== null && value !== undefined ? String(value) : "";
  return template
    .replace(/<[a-zA-Z0-9_-]+>/g, val)
    .replace(/\{\{[a-zA-Z0-9_-]+\}\}/g, val)
    .replace(/\{[a-zA-Z0-9_-]+\}/g, val);
}

function isAiPrompt(input) {
  if (!input || typeof input !== "string") return false;
  return input.trim().toLowerCase().indexOf("/ai") === 0;
}

function cleanAiPrompt(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/^\s*\/ai\s*/i, "").trim();
}

function filterCommands(categories, searchQuery) {
  if (!searchQuery || !searchQuery.trim()) {
    return categories || [];
  }

  var q = searchQuery.trim();
  var filtered = [];

  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var cmds = cat.commands || cat.shortcuts || [];
    var matchingCmds = [];

    for (var j = 0; j < cmds.length; j++) {
      var c = cmds[j];
      var nameMatch = fuzzyMatch(q, c.name);
      var cmdMatch = fuzzyMatch(q, c.command || c.template);

      if (nameMatch.matched || cmdMatch.matched) {
        var topScore = Math.max(nameMatch.score, cmdMatch.score);
        var copy = {};
        for (var key in c) copy[key] = c[key];
        copy.matchScore = topScore;
        matchingCmds.push(copy);
      }
    }

    if (matchingCmds.length > 0) {
      matchingCmds.sort(function(a, b) { return b.matchScore - a.matchScore; });
      filtered.push({
        name: cat.name,
        commands: matchingCmds
      });
    }
  }

  return filtered;
}

function formatOutput(rawOutput) {
  if (!rawOutput) return "";
  var str = String(rawOutput).trim();

  // JSON pretty print check
  if ((str.indexOf("{") === 0 && str.lastIndexOf("}") === str.length - 1) ||
      (str.indexOf("[") === 0 && str.lastIndexOf("]") === str.length - 1)) {
    try {
      var obj = JSON.parse(str);
      return JSON.stringify(obj, null, 2);
    } catch (e) {}
  }

  return str;
}
