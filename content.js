"use strict";

// Global state
let lastMsg = {};
let counter = 0;
let reply = null;

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

function injectUrl(counter, node, currentOffset, startOffset, endOffset, url, content, decl) {
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
      a.setAttribute("class", "gotodev-code js-skip-tagsearch"); /* `js-skip-tagsearch` prevents future semantic injection */
      a.href = url;
      parent.replaceChild(a, node);
      a.appendChild(node);

      tippy(
        a,
        {
          placement: "top-start",
          theme: "gotodev",
          appendTo: document.body, /* silences a warning about accessibility */
          allowHTML: true,
          maxWidth: 600,
          content: `
<div class="px-3 pb-2">
  <span class="f6 lh-consended-ultra text-gray-light">Data provided by <a href="https://goto.dev" class="no-underline">goto.dev</a></span>

  <div class="f6 color-text-tertiary mb-1">
    <a title="${decl.slug}" class="d-inline-block no-underline Link--secondary" href="/${decl.slug}">${decl.slug}</a>
    on ${decl.refName}
  </div>

  <div class="blob-code-inner" style="line-height: 20px; vertical-align: top; overflow: hidden; text-overflow: ellipsis;">${content}</div>
</div>`,
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
    currentOffset = injectUrl(counter, child, currentOffset, startOffset, endOffset, url, content, decl);
  }

  return currentOffset;
}

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
          injectUrl(counter, lineElement, 0, sym.startOffset, sym.endOffset, sym.url, sym.hovercard, sym.decl);
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
