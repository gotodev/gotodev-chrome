"use strict";

// Global state
let counter = 0;
let reply = null;
const observer = new MutationObserver((mutations) => {
  mutations.forEach(m => {
    m.removedNodes.forEach(n => {
      if (n.tagName == 'INCLUDE-FRAGMENT') {
        onPageUpdated();
      }
    });
  });
});

// Subscribe to page updates
document.addEventListener("DOMContentLoaded", () => { onPageUpdated(); });
document.addEventListener("pjax:end", () => { onPageUpdated(); });

function onPageUpdated() {
  for (const n of document.querySelectorAll(".js-diff-progressive-container > include-fragment")) {
    observer.observe(n.parentNode, {childList: true});
    return;
  }

  fetchSymbols();
  attachEventHandlers();
}

function attachEventHandlers() {
  for (const n of document.querySelectorAll(".js-file-line-container, .js-file-content")) {
    n.setAttribute("data-gotodev-attached", true);
    n.addEventListener("mouseover", mouseOverHandler);
  }
}

function escapeHTML(unsafeText) {
  const e = document.createElement('div');
  e.textContent = unsafeText;
  return e.innerHTML;
}

// Runs the given callback function at the specified offsets within the node's text,
// allowing the DOM to be altered.
function inject(counter, node, currentOffset, startOffset, endOffset, cb) {
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

    cb(node);

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
    currentOffset = inject(counter, child, currentOffset, startOffset, endOffset, cb);
  }

  return currentOffset;
}

function injectHovercard(node, decl) {
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
    if (decl.slug && decl.refName && decl.path && decl.line) {
      a.href = `https://github.com/${decl.slug}/blob/${decl.refName}/${decl.path}#L${decl.line}`;
    }
    parent.replaceChild(a, node);
    a.appendChild(node);

    const thisRepository = decl.slug === reply.msg.slug && decl.refDate === "";
    const thisCommit = thisRepository && reply.msg.paths.includes(decl.path);

    tippy(
      a,
      {
        placement: "top-start",
        theme: "gotodev",
        appendTo: document.body, /* silences a warning about accessibility */
        zIndex: 99999,
        allowHTML: true,
        maxWidth: 800,
        content: `
<div class="px-3 pb-2">
  <span class="f6 lh-consended-ultra text-gray-light">Data provided by <a href="https://goto.dev" class="no-underline">goto.dev</a></span>

  <div class="f6 color-text-tertiary">
    ${thisRepository ?
      (
        thisCommit ? "Changed in this commit" : "This repository"
      ) :
      (
        decl.slug && decl.refDate ? escapeHTML(decl.slug) + " on " + escapeHTML(decl.refDate) : ""
      )
    }
  </div>

  <pre class="blob-code-inner gotodev-snippet lang-java" style="line-height: 20px; vertical-align: top; overflow-wrap: normal; white-space: pre-wrap;"><code>${escapeHTML(decl.snippet.snippet)}</code></pre>
</div>`,
        onCreate: (t) => {
          t.popper.querySelectorAll('.gotodev-snippet').forEach((block) => {
            Prism.highlightElement(block);

            function injectStyle(offsets, cb) {
              if (offsets) {
                for (let i = 0; i+1 < offsets.length; i += 2) {
                  inject(0, block, 0, offsets[i], offsets[i+1], node => {
                    let parent = node.parentNode;
                    if (parent) {
                      const e = cb();
                      parent.replaceChild(e, node);
                      e.appendChild(node);
                    }
                  });
                }
              }
            };

            injectStyle(decl.snippet.emphases, () => {
              const e = document.createElement("span");
              e.style.fontWeight = "bold";
              e.style.background = "rgba(255, 179, 109, 0.3)";
              return e;
            });

            injectStyle(decl.snippet.dims, () => {
              const e = document.createElement("span");
              e.style.opacity = 0.6;
              return e;
            });
          });
        },
    });
  }
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
  } else if ((element = document.querySelector("summary[data-hotkey=\'t\'] + details-menu")) && element.getAttribute("src")) {
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

    console.log("[goto.dev] Reply: %o", result);
    console.log("[goto.dev] Resolved %d right files: %o", result.right.length, result.right);
    if (result.left) {
      console.log("[goto.dev] Resolved %d left files: %o", result.left.length, result.left);
    }

    reply = result;
    reply.msg = msg;
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
        if (sym[0] == line) {
          const startOffset = sym[1];
          const endOffset = sym[2];
          const declIDs = reply.decls[sym[3]];

          let decl = {
            snippet: reply.snippets[declIDs[0]],
            doc: reply.docs[declIDs[1]],
          }

          if (declIDs.length >= 7) {
            decl.slug = reply.slugs[declIDs[2]];
            decl.refName = reply.refNames[declIDs[3]];
            decl.refDate = reply.refDates[declIDs[4]];
            decl.path = reply.paths[declIDs[5]];
            decl.line = declIDs[6];
          }
          inject(counter, lineElement, 0, startOffset, endOffset, node => injectHovercard(node, decl));
        }
      }
    }
  }
}
