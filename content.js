"use strict";

// Global state
let lastMsg = {};
let hovercardElement = null;
let lastTargetElement = null;
let closingTimer = null;

// Hackish way to identify AJAX updates
setInterval(
  function(){
    if (!fetchSymbols()) {
      // AJAX reload not ready, retry in a bit
      return
    }
    attachEventHandlers();
  },
  200,
);

function injectUrl(counter, node, currentOffset, startOffset, endOffset, url, content) {
  if (!node.hasChildNodes()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      return currentOffset;
    }

    const newCurrentOffset = currentOffset + node.data.length;
    if (newCurrentOffset === currentOffset) {
      return newCurrentOffset;
    }

    startOffset = Math.max(startOffset, currentOffset);
    endOffset = Math.min(endOffset, newCurrentOffset);
    if (endOffset <= startOffset) {
      return newCurrentOffset;
    }

    const leftLength = startOffset - currentOffset;
    if (leftLength > 0) {
      // There is a non-linked left part
      node = node.splitText(leftLength);
    }

    const rightLength = newCurrentOffset - endOffset;
    if (rightLength > 0) {
      // There is a non-linked right part
      const linkedLength = endOffset - startOffset;
      node.splitText(linkedLength);
    }

    let parent = node.parentNode;
    if (parent && parent.parentNode && parent.classList && parent.classList.contains("pl-token")) {
      // Disable already injected semantic
      const newParent = parent.cloneNode(false); // Does not copy programmatically injected event listeners
      newParent.classList.remove("pl-token");
      for (let i = 0; i < parent.childNodes.length; i++) {
        newParent.appendChild(parent.childNodes[i]);
      }
      parent.parentNode.replaceChild(newParent, parent);
      parent = newParent;
    }
    if (parent) {
      const a = document.createElement("a");
      a.setAttribute("data-gotodev-insertion", counter);
      a.setAttribute("class", "gotodev js-skip-tagsearch"); /* `js-skip-tagsearch` prevents future semantic injection */
      a.href = url;
      parent.replaceChild(a, node);
      a.appendChild(node);

      // Hovercard
      a.addEventListener("mouseover", e => openHovercard(e, content == "" ? "Javadoc unavailable" : content));
      a.addEventListener("mouseout", e => {
        // Close the hovercard with a delay
        const targetElement = lastTargetElement;
        closingTimer = window.setTimeout(() => {
          // Check if the current hovercard is still the one we wanted to close
          if (targetElement === lastTargetElement) {
            closeHovercard(e);
          }
        }, 100);
      });
    }

    return newCurrentOffset;
  }

  // Children will be added during the loop's iteration,
  // so we need to make a copy of it and not simply held
  // a reference to not risk an infinite loop.
  const children = Array.from(node.childNodes);

  // If needed, first hoist all children to undo previous injection
  if (node.getAttribute("data-gotodev-counter") && node.getAttribute("data-gotodev-counter") != counter) {
    const parent = node.parentNode;
    if (parent) {
      for (const child of children) {
        parent.insertBefore(child, node);
      }
      parent.removeChild(node);
    }
  }

  // New injection
  for (const child of children) {
    currentOffset = injectUrl(counter, child, currentOffset, startOffset, endOffset, url, content);
  }

  return currentOffset;
}

let counter = 0;
let reply = null;

function fetchSymbols() {
  let matches;
  matches = window.location.href.match("^https://github\\.com/([^/#]+/[^/#]+)/(commit|tree|blob|blame|pull|commits)/([^#?]+)(?:[#?].*)?$")
  if (!matches || matches[2] === "commits") {
    // Unsupported page
    return true;
  }
  const [, , kind, refNamePath] = matches

  let url;
  let element;
  if ((element = document.querySelector(".js-permalink-shortcut")) && element.href) {
    url = element.href;
  } else if ((element = document.querySelector(".toc-select > details-menu")) && element.getAttribute("src")) {
    url = element.getAttribute("src");
  } else {
    return false;
  }

  let msg;
  if (matches = url.match("^https://github\\.com/([^/#]+/[^/#]+)/blob/([0-9a-fA-F]{40})/([^#]+)$")) {
    const [, slug, commit, path] = matches;
    msg = {kind: "blob", slug: slug, right: commit, paths: [path]};
  } else if (matches = url.match("^https://github\\.com/([^/#]+/[^/#]+)/blame/([0-9a-fA-F]{40})/([^#]+)$")) {
    const [, slug, commit, path] = matches;
    msg = {kind: "blame", slug: slug, right: commit, paths: [path]};
  } else if (matches = url.match("^https://github\\.com/([^/#]+/[^/#]+)/commit/([0-9a-fA-F]{40})$")) {
    const [, slug, commit] = matches;
    const parentCommitElement = document.querySelector("a[data-hotkey='p']");
    let parentCommit;
    if (parentCommitElement) {
      if (parentCommitElement.href.length <= 40) {
        // Unexpected
        return false;
      }
      parentCommit = parentCommitElement.href.substr(-40);
    } else {
      // Assume initial commit
      parentCommit = "";
    }

    msg = {kind: "commit", slug: slug, left: parentCommit, right: commit, paths: []};
  } else if (matches = url.match("^/([^/#]+/[^/#]+)/pull/([0-9]+)/show_toc\\?base_sha=([0-9a-fA-F]{40})&sha1=([0-9a-fA-F]{40})&sha2=([0-9a-fA-F]{40})$")) {
    const [, slug, id, baseSha, leftSha, rightSha] = matches;
    msg = {kind: "pull", slug: slug, id: id, base: baseSha, left: leftSha, right: rightSha, paths: []};
  } else {
    // Unexpected
    return false;
  }

  if (kind != "pull") {
    if (kind == "commit") {
      msg.refName = refNamePath;
    } else if (msg.paths.length == 1 && "/"+msg.paths[0] == refNamePath.substr(-msg.paths[0].length-1)) {
      msg.refName = refNamePath.substr(0, refNamePath.length-msg.paths[0].length-1);
    } else {
      // Unexpected
      return false;
    }
  }

  if (msg.kind === "commit" || msg.kind === "pull") {
    for (const e of document.querySelectorAll(".file-header[data-path]")) {
      msg.paths.push(e.getAttribute("data-path"));
    }
  }

  // TODO Hack to allow more paths to arrive onto the DOM as it loads
  if (lastMsg.counter) {
    msg.counter = lastMsg.counter;
  }
  if (JSON.stringify(lastMsg) === JSON.stringify(msg)) {
    return false;
  }
  lastMsg = msg;

  let startTime = window.performance.now();
  counter++;
  msg.counter = counter;
  reply = null;

  console.log("[goto.dev] Resolving reference for: %o", msg);

  chrome.runtime.sendMessage(msg, function(response) {
    console.log("[goto.dev] Received server response in: %dms", window.performance.now() - startTime);

    if (!response) {
      console.log("[goto.dev] Undefined response");
      return;
    }

    if (counter != msg.counter) {
      // Outdated message
      console.log("[goto.dev] Ignoring outdated server response: %o", response);
      return;
    }

    const error = response.error;
    if (error) {
      console.log("[goto.dev] ERROR %s", error);
      return;
    }

    const result = response.result;
    if (!result.right) {
      console.log("[goto.dev] ERROR Invalid response: %o", response);
      return;
    }

    console.log("[goto.dev] Resolved %d right files: %o", result.right.length, result.right);
    if (result.left) {
      console.log("[goto.dev] Resolved %d left files: %o", result.left.length, result.left);
    }

    reply = result;
  });

  return true;
}

function mouseOverHandler(e) {
  if (!reply) {
    // Reply not yet available
    return;
  }

  const lineElement = e.target.closest(".blob-code-inner");
  if (!lineElement) {
    return;
  }

  const rowElement = lineElement.closest("td, div");
  if (!rowElement || !rowElement.previousElementSibling) {
    return;
  }

  if (rowElement.getAttribute("data-gotodev-counter") == counter) {
    // Already processed
    return;
  }
  rowElement.setAttribute("data-gotodev-counter", counter);

  let side, path, line;

  const fileElement = rowElement.closest(".js-file-content");
  if (fileElement && fileElement.previousElementSibling) {
    path = fileElement.previousElementSibling.getAttribute("data-path");
    if (!path) {
      // Unexpected
      return;
    }
  }

  if (!path && rowElement.getAttribute("id").substr(0, 2) == "LC") {
    // Blob view
    side = reply.right;
    line = rowElement.getAttribute("id").substr(2);
  } else if (rowElement.hasAttribute("data-split-side")) {
    // Split view
    if (!rowElement.hasAttribute("data-split-side")) {
      // Unexpected
      return;
    }
    side = rowElement.getAttribute("data-split-side") == "left" ? reply.left : reply.right;
    line = rowElement.previousElementSibling.getAttribute("data-line-number");
  } else if (rowElement.previousElementSibling.previousElementSibling) {
    // Unified view
    if (rowElement.previousElementSibling.hasAttribute("data-line-number")) {
      side = reply.right;
      line = rowElement.previousElementSibling.getAttribute("data-line-number");
    } else {
      side = reply.left;
      line = rowElement.previousElementSibling.previousElementSibling.getAttribute("data-line-number");
    }
  } else {
    return;
  }

  if (!line) {
    // Unexpected
    return;
  }

  if (!side) {
    // No data
    return;
  }

  for (const file of side) {
    if (!path || file.path == path) {
      for (const sym of file.refs) {
        if (sym.startLine == line) {
          injectUrl(counter, lineElement, 0, sym.startOffset, sym.endOffset, sym.url, sym.hovercard);
        }
      }
    }
  }
}

function attachEventHandlers() {
  for (const n of document.querySelectorAll(".js-file-line-container, .js-file-content")) {
    if (n.getAttribute("data-gotodev-attached")) {
      continue;
    }

    n.setAttribute("data-gotodev-attached", true);
    n.addEventListener("mouseover", mouseOverHandler);
  }
}

function closeHovercard(e) {
  if (!lastTargetElement) {
    return;
  }

  if (e instanceof MouseEvent && e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest(".js-hovercard-content")) {
    // Mouse entered the hovercard
    return
  }

  resetHovercard();
}

function resetHovercard() {
  hovercardElement.style.display = "none";
  hovercardElement.children[0].innerHTML = "";
  lastTargetElement = null;
}

function openHovercard(e, content) {
  (async function() {
    const targetElement = e.currentTarget;

    resetHovercard();
    lastTargetElement = targetElement;

    const delay = new Promise(e => window.setTimeout(e, 250, 0)); // Delay the opening
    let box = document.createElement("div");
    box.innerHTML = `
<div class="px-3 pb-2">
  <span class="f6 lh-consended-ultra text-gray-light">Data provided by <a href="https://goto.dev" class="no-underline">goto.dev</a></span>

  <p>${content}</p>
  <button class="btn btn-sm btn-primary mr-2" type="button">Go to definition</button><button class="btn btn-sm mr-2" type="button">More actions</button>

  <div class="sr-only">Press escape to close this hovercard</div>
</div>`;
    await delay

    if (targetElement !== lastTargetElement) {
      // The mouse moved away from the target element while waiting for the delay => hovercard no longer needed
      return;
    }

    insertHovercard(box, () => hovercardPosition(targetElement, e.clientX));
  })()
}

function hovercardPosition(targetElement, mouseX) {
  const {width: t, height: n} = hovercardElement.getBoundingClientRect();
  const {left: s, top: o, height: r, width: i} =
    function() {
      const t = targetElement.getClientRects();
      let n = t[0];
      for (const s of t)
        if (s.left < mouseX && s.right > mouseX) {
          n = s;
          break
        }
      return n
  }();
  const a = o > n; // Meaning?
  const b = window.innerWidth - s > t; // Meaning?
  const c = s + i / 2;
  return {
      containerTop: a ? o - n - 12 : o + r + 12,
      containerLeft: b ? c - 24 : c - t + 24,
      contentClassSuffix: a ? b ? "bottom-left" : "bottom-right" : b ? "top-left" : "top-right"
  }
}

function insertHovercard(content, getPosition) {
  const root = hovercardElement.children[0];
  root.innerHTML = "";
  const container = document.createElement("div");
  for (const child of content.children) {
    container.appendChild(child);
  }
  root.appendChild(container);

  hovercardElement.style.visibility = "hidden";
  hovercardElement.style.display = "block";

  const position = getPosition();

  root.classList.remove("Popover-message--bottom-left", "Popover-message--bottom-right", "Popover-message--right-top", "Popover-message--right-bottom", "Popover-message--top-left", "Popover-message--top-right");
  root.classList.add("Popover-message--" + position.contentClassSuffix);

  hovercardElement.style.top = `${position.containerTop + window.pageYOffset}px`;
  hovercardElement.style.left = `${position.containerLeft + window.pageXOffset}px`;
  hovercardElement.style.zIndex = "100";
  hovercardElement.style.display = "block";
  hovercardElement.style.visibility = "";
}

document.addEventListener("DOMContentLoaded", (e) => {
  hovercardElement = document.querySelector(".js-hovercard-content");
  lastTargetElement = null;
  closingTimer = null;

  hovercardElement.addEventListener("mouseover", e => {
    if (closingTimer) {
      // Cancel the delayed hovercard closing
      clearTimeout(closingTimer);
      closingTimer = null;
    }
  });
  hovercardElement.addEventListener("mouseleave", e => closeHovercard(e));
  hovercardElement.addEventListener("keyup", e => {
    if (e.key == "Escape") {
      closeHovercard(e);
    }
  });
});
