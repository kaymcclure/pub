// Shared to-do list. Todos live in Supabase (see supabase/todo.sql) and every
// request carries the passcode, which the database checks. Changes show on
// screen immediately, are saved in the background, and the list re-syncs
// every few seconds so other phones and computers stay up to date.
(function () {
  "use strict";

  const cfg = window.TODO_CONFIG || {};
  const POLL_MS = 8000;
  const TAGS = ["brian", "melissa", "both"];
  const FILTERS = ["all", "brian", "melissa"];
  const TAG_NAME = { brian: "Brian", melissa: "Melissa", both: "Melissa & Brian" };

  // ---- Small helpers ---------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  // Per-device settings. The page still works if storage is unavailable; the
  // passcode just has to be entered again next time.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("todo:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem("todo:" + key);
        else localStorage.setItem("todo:" + key, JSON.stringify(value));
      } catch {
        /* nothing to remember with */
      }
    },
  };

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  // Calls a database function through Supabase's REST API.
  async function rpc(fn, args) {
    const headers = { apikey: cfg.key, "Content-Type": "application/json" };
    // Legacy anon keys are JWTs and also go in Authorization; newer
    // publishable keys must not.
    if (cfg.key.startsWith("eyJ")) headers.Authorization = "Bearer " + cfg.key;
    let res;
    try {
      res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
      });
    } catch {
      throw Object.assign(new Error("offline"), { offline: true });
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = (body && body.message) || res.statusText;
      throw Object.assign(new Error(message), { badPasscode: /bad passcode/.test(message) });
    }
    return body;
  }

  // ---- State -------------------------------------------------------------------

  let code = store.get("code", null);
  let newTag = TAGS.includes(store.get("tag")) ? store.get("tag") : "both";
  let filter = FILTERS.includes(store.get("filter")) ? store.get("filter") : "all";
  let todos = [];
  let pending = 0; // saves in flight; syncing waits so it can't undo them on screen
  let editingId = null; // the todo whose text is being edited
  let lastSync = 0;
  let problem = ""; // shown in the status line
  let tempId = -1;

  // ---- Views -------------------------------------------------------------------

  function show(view) {
    $("gate").hidden = view !== "gate";
    $("setup").hidden = view !== "setup";
    $("app").hidden = view !== "app";
    renderStatus();
  }

  function lock(message) {
    code = null;
    store.set("code", null);
    todos = [];
    $("gate-error").textContent = message || "";
    $("gate-code").value = "";
    show("gate");
  }

  function renderStatus() {
    const status = $("status");
    if ($("app").hidden) {
      status.textContent = "";
      return;
    }
    if (problem) status.textContent = problem;
    else if (pending > 0) status.textContent = "Saving…";
    else if (!lastSync) status.textContent = "Loading…";
    else {
      const mins = Math.floor((Date.now() - lastSync) / 60000);
      status.textContent = "Synced " + (mins < 1 ? "just now" : mins === 1 ? "1 min ago" : `${mins} min ago`);
    }
  }

  function banner(tag, onclick) {
    const attrs = { class: `banner tag-${tag}`, type: "button" };
    if (onclick) {
      attrs.onclick = onclick;
      attrs.title = "Tap to change who it's for";
      attrs["aria-label"] = `For ${TAG_NAME[tag]}. Tap to change.`;
    }
    return tag === "both"
      ? el("button", attrs, el("span", {}, "Melissa"), el("span", {}, "Brian"))
      : el("button", attrs, TAG_NAME[tag]);
  }

  function renderItem(t) {
    const saving = t.id < 0;
    const text =
      editingId === t.id
        ? el("input", {
            class: "edit",
            value: t.text,
            maxlength: "500",
            "aria-label": "Edit to-do",
            onkeydown: (e) => {
              if (e.key === "Enter") e.target.blur();
              if (e.key === "Escape") {
                e.target.value = t.text;
                e.target.blur();
              }
            },
            onblur: (e) => finishEdit(t, e.target.value),
          })
        : el("span", {
            class: "text",
            role: "button",
            tabindex: "0",
            title: "Tap to edit",
            onclick: () => startEdit(t),
            onkeydown: (e) => {
              if (e.key === "Enter") startEdit(t);
            },
          }, t.text);

    return el("li", { class: `todo tag-${t.tag}${t.done ? " done" : ""}${saving ? " saving" : ""}` },
      banner(t.tag, saving ? null : () => cycleTag(t)),
      el("div", { class: "row" },
        el("button", {
          class: "check",
          type: "button",
          "aria-pressed": String(t.done),
          "aria-label": t.done ? "Mark not done" : "Mark done",
          disabled: saving,
          onclick: () => toggleDone(t),
        }),
        text,
        el("button", {
          class: "delete",
          type: "button",
          "aria-label": "Delete",
          disabled: saving,
          onclick: () => remove(t),
        }, "✕")));
  }

  function render() {
    const shown = todos.filter((t) => filter === "all" || t.tag === filter || t.tag === "both");
    const open = shown.filter((t) => !t.done).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const done = shown.filter((t) => t.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));

    $("open-list").replaceChildren(...open.map(renderItem));
    $("done-list").replaceChildren(...done.map(renderItem));
    $("done-count").textContent = String(done.length);
    $("done-section").hidden = done.length === 0;
    $("empty").hidden = open.length > 0;

    for (const b of document.querySelectorAll(".filter")) {
      const on = b.dataset.filter === filter;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    }
    for (const b of document.querySelectorAll(".tag-option")) {
      const on = b.dataset.tag === newTag;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-checked", String(on));
    }

    const input = document.querySelector(".todo .edit");
    if (input && document.activeElement !== input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    renderStatus();
  }

  // ---- Syncing -----------------------------------------------------------------

  async function refresh() {
    if (!code || pending > 0 || editingId !== null) return;
    try {
      const rows = await rpc("todo_list", { p_code: code });
      if (pending > 0 || editingId !== null) return; // a newer local change wins
      todos = rows;
      lastSync = Date.now();
      problem = "";
      render();
    } catch (e) {
      failed(e);
    }
  }

  function failed(e, saving) {
    if (e.badPasscode) {
      lock("That passcode no longer works. Enter the current one.");
      return;
    }
    if (saving) problem = "Couldn't save that change. Check your connection and try again.";
    else problem = e.offline ? "Offline — can't sync right now" : "Couldn't sync: " + e.message;
    renderStatus();
  }

  // Shows a change right away, saves it, then re-syncs with the database.
  async function change(applyLocally, save) {
    applyLocally();
    pending++;
    render();
    try {
      await save();
    } catch (e) {
      failed(e, true);
      pending--;
      return; // keep the message visible instead of re-syncing over it
    }
    pending--;
    await refresh();
  }

  // ---- Actions -----------------------------------------------------------------

  function add(text) {
    const item = {
      id: tempId--,
      text,
      tag: newTag,
      done: false,
      created_at: new Date().toISOString(),
      done_at: null,
    };
    return change(
      () => todos.push(item),
      () => rpc("todo_add", { p_code: code, p_text: text, p_tag: item.tag }));
  }

  function toggleDone(t) {
    const done = !t.done;
    change(
      () => {
        t.done = done;
        t.done_at = done ? new Date().toISOString() : null;
      },
      () => rpc("todo_update", { p_code: code, p_id: t.id, p_done: done }));
  }

  function cycleTag(t) {
    const tag = TAGS[(TAGS.indexOf(t.tag) + 1) % TAGS.length];
    change(
      () => (t.tag = tag),
      () => rpc("todo_update", { p_code: code, p_id: t.id, p_tag: tag }));
  }

  function startEdit(t) {
    if (t.id < 0) return;
    editingId = t.id;
    render();
  }

  function finishEdit(t, value) {
    if (editingId !== t.id) return;
    editingId = null;
    const text = value.trim();
    if (!text || text === t.text) {
      render();
      refresh();
      return;
    }
    change(
      () => (t.text = text),
      () => rpc("todo_update", { p_code: code, p_id: t.id, p_text: text }));
  }

  function remove(t) {
    if (!confirm(`Delete "${t.text}"?`)) return;
    change(
      () => (todos = todos.filter((x) => x !== t)),
      () => rpc("todo_delete", { p_code: code, p_id: t.id }));
  }

  // ---- Wiring ------------------------------------------------------------------

  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const attempt = $("gate-code").value.trim();
    const button = e.submitter || $("gate-form").querySelector("button");
    button.disabled = true;
    $("gate-error").textContent = "";
    try {
      if (await rpc("todo_check", { p_code: attempt })) {
        code = attempt;
        store.set("code", code);
        lastSync = 0;
        show("app");
        render();
        await refresh();
      } else {
        $("gate-error").textContent = "That passcode isn't right.";
      }
    } catch (err) {
      $("gate-error").textContent = err.offline
        ? "Couldn't reach the list. Check your connection."
        : "Something went wrong: " + err.message;
    } finally {
      button.disabled = false;
    }
  });

  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("add-text");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.focus();
    add(text);
  });

  for (const b of document.querySelectorAll(".tag-option")) {
    b.addEventListener("click", () => {
      newTag = b.dataset.tag;
      store.set("tag", newTag);
      render();
    });
  }

  for (const b of document.querySelectorAll(".filter")) {
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      store.set("filter", filter);
      render();
    });
  }

  $("clear-done").addEventListener("click", () => {
    if (!confirm("Remove all done items for everyone?")) return;
    change(
      () => (todos = todos.filter((t) => !t.done)),
      () => rpc("todo_clear_done", { p_code: code }));
  });

  $("lock").addEventListener("click", () => lock());

  // Keep in step with other devices while the page is open.
  setInterval(() => {
    if (document.visibilityState === "visible") refresh();
    renderStatus();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  window.addEventListener("online", refresh);

  if (!cfg.url || !cfg.key) {
    show("setup");
  } else if (code) {
    show("app");
    render();
    refresh();
  } else {
    show("gate");
  }
})();
