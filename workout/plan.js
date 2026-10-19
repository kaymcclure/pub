// Knee-friendly strength plan: the plan data and the small amount of UI around
// it (workout tabs, phase picker, tap-to-check set circles). Checked sets and
// the chosen phase are remembered in this browser only.
(function () {
  "use strict";

  // Cycle classes run Mon, Wed, Fri, Sat and Sun, so the gym days sit on
  // Tue, Thu and Sat with a recovery day between each.
  const WEEK = [
    { day: "Mon", what: "Cycle class", kind: "cardio" },
    { day: "Tue", what: "Gym: Workout A", kind: "gym", workout: "A" },
    { day: "Wed", what: "Walk 30–45 min (or cycle class)", kind: "cardio" },
    { day: "Thu", what: "Gym: Workout B", kind: "gym", workout: "B" },
    { day: "Fri", what: "Cycle class", kind: "cardio" },
    { day: "Sat", what: "Gym: Workout C", kind: "gym", workout: "C" },
    { day: "Sun", what: "Rest (or an easy cycle class)", kind: "rest" },
  ];

  // Index into each exercise's `sets` array.
  const PHASES = [
    {
      name: "Weeks 1–4",
      label: "Foundation",
      note: "Learn the movements with light weights. Stop each set when you could still do about 4 more reps. Expect to finish a little early: that's fine.",
    },
    {
      name: "Weeks 5–8",
      label: "Build",
      note: "Add a set to most exercises. Stop each set with about 3 reps left in the tank, and start using the two-for-two rule to add weight.",
    },
    {
      name: "Weeks 9–12",
      label: "Strengthen",
      note: "The main leg lifts get 4 sets. Sets should feel challenging: stop with about 2 good reps left.",
    },
  ];

  const WARMUP = [
    "5 min easy on a bike or elliptical, building to a light sweat",
    "Glute bridges × 10",
    "Side-lying clamshells × 10 each side",
    "Band pull-aparts × 15",
    "Bodyweight sit-to-stand from a bench × 8 (slow, hips back)",
  ];

  const COOLDOWN = [
    "Hip flexor stretch (half-kneel on a pad) — 30 s each side",
    "Hamstring stretch (heel on a low bench, lean forward) — 30 s each side",
    "Quad stretch (standing, hold a rail; skip if it pinches) — 30 s each side",
    "Calf stretch against a wall — 30 s each side",
    "Doorway chest stretch — 30 s",
  ];

  // Exercises run as pairs (supersets): do one set of each back-to-back, rest
  // 60–90 s, repeat. `sets` gives the set count for each phase.
  const WORKOUTS = {
    A: {
      title: "Workout A",
      focus: "Squat pattern, hinge & push",
      exercises: [
        {
          pair: "1", name: "Goblet box squat", reps: "10", sets: [2, 3, 4],
          how: "Hold a dumbbell at your chest and sit back to a bench or box at knee height or higher, tap it, then stand.",
          knee: "Use a higher box if your knees complain. Lower the box only once this feels easy.",
          swap: "Leg press with a short range, or glute bridges.",
        },
        {
          pair: "1", name: "Seated cable row", reps: "10–12", sets: [2, 3, 3],
          how: "Chest tall, pull the handle to your lower ribs, squeeze shoulder blades together.",
        },
        {
          pair: "2", name: "Dumbbell Romanian deadlift", reps: "10", sets: [2, 3, 4],
          how: "Soft knees, push hips back and slide the dumbbells down your thighs until you feel your hamstrings, then stand tall.",
          knee: "Knees stay nearly still, so this strengthens your legs with very little knee stress.",
          swap: "Cable pull-through.",
        },
        {
          pair: "2", name: "Machine chest press", reps: "10–12", sets: [2, 3, 3],
          how: "Handles at mid-chest height, press out without locking elbows hard.",
        },
        {
          pair: "3", name: "Glute bridge", reps: "12", sets: [2, 3, 3],
          how: "Feet flat, drive through heels and squeeze glutes at the top. Add a dumbbell or use the hip thrust machine once 12 is easy.",
          knee: "Strong glutes take load off your knees.",
        },
        {
          pair: "3", name: "Pallof press", reps: "10 each side", sets: [2, 2, 3],
          how: "Stand side-on to a cable at chest height, press the handle straight out and resist the twist.",
        },
        {
          pair: "4", name: "Dead bug", reps: "8 each side", sets: [2, 2, 2],
          how: "On your back, arms up, knees bent at 90°. Slowly lower opposite arm and leg while keeping your low back down.",
        },
      ],
    },
    B: {
      title: "Workout B",
      focus: "Leg press, pull & hamstrings",
      exercises: [
        {
          pair: "1", name: "Leg press (short range)", reps: "10–12", sets: [2, 3, 4],
          how: "Feet high and hip-width on the platform. Lower until knees are at about 90°, no deeper, then press.",
          knee: "Feet higher on the platform shifts work to your hips and away from the front of the knee.",
          swap: "Goblet box squat to a high box.",
        },
        {
          pair: "1", name: "Lat pulldown", reps: "10–12", sets: [2, 3, 3],
          how: "Pull the bar to your upper chest, elbows down toward your back pockets.",
        },
        {
          pair: "2", name: "Hamstring curl machine", reps: "12", sets: [2, 3, 3],
          how: "Seated or lying. Curl smoothly, lower slowly over 3 seconds.",
          knee: "Strong hamstrings help stabilise the knee.",
        },
        {
          pair: "2", name: "Seated dumbbell shoulder press", reps: "10", sets: [2, 3, 3],
          how: "Back supported, press up and slightly in, lower to ear height.",
        },
        {
          pair: "3", name: "45° back extension", reps: "10", sets: [2, 3, 3],
          how: "Hinge at the hips, lower your chest, rise until your body is in a straight line. No over-arching.",
          swap: "Bird dog, or a light dumbbell Romanian deadlift.",
        },
        {
          pair: "3", name: "Hip abduction machine", reps: "15", sets: [2, 2, 3],
          how: "Push knees out against the pads, pause, return slowly.",
          knee: "Side-hip strength keeps your knees tracking straight on stairs and squats.",
        },
        {
          pair: "4", name: "Side plank from knees", reps: "20–30 s each side", sets: [2, 2, 2],
          how: "Elbow under shoulder, hips lifted in a straight line from knees to head.",
        },
      ],
    },
    C: {
      title: "Workout C",
      focus: "Deadlift, step-ups & full body",
      exercises: [
        {
          pair: "1", name: "Kettlebell or trap bar deadlift", reps: "8", sets: [2, 3, 4],
          how: "Weight between your feet (or trap bar), hips back, flat back, stand up by driving the floor away.",
          knee: "Hip-dominant: keep your shins fairly upright.",
          swap: "Dumbbell Romanian deadlift.",
        },
        {
          pair: "1", name: "Incline dumbbell press", reps: "10", sets: [2, 3, 3],
          how: "Bench at a low incline, press dumbbells up over your chest.",
        },
        {
          pair: "2", name: "Low step-up", reps: "8 each leg", sets: [2, 3, 3],
          how: "Step onto a 15–30 cm (6–12 in) box, push through the whole foot, step down slowly. Hold a rail or light dumbbells.",
          knee: "Start with the lowest step. Keep your knee over your second toe; raise the box only when it's pain-free.",
          swap: "Hip thrust, or glute bridge on one leg.",
        },
        {
          pair: "2", name: "One-arm dumbbell row", reps: "10 each side", sets: [2, 3, 3],
          how: "Hand and knee on a bench, pull the dumbbell toward your hip.",
        },
        {
          pair: "3", name: "Banded terminal knee extension", reps: "15 each leg", sets: [2, 2, 3],
          how: "Loop a band behind your knee, anchored in front. From a slightly bent knee, straighten fully against the band and squeeze your thigh.",
          knee: "Targets the quad muscle that steadies the kneecap, with almost no joint load.",
        },
        {
          pair: "3", name: "Bird dog", reps: "8 each side", sets: [2, 2, 2],
          how: "On hands and knees (use a pad), reach opposite arm and leg long, pause 2 seconds.",
        },
        {
          pair: "4", name: "Farmer's carry", reps: "30–40 m", sets: [2, 3, 3],
          how: "Heavy dumbbells at your sides, stand tall, walk with short steady steps.",
        },
      ],
    },
  };

  // ---- Persistence (this browser only; everything still works without it) ----

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("workout:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("workout:" + key, JSON.stringify(value));
      } catch {
        /* storage unavailable: nothing to remember */
      }
    },
  };

  const todayIndex = (new Date().getDay() + 6) % 7; // Monday = 0
  const todayWorkout = WEEK[todayIndex].workout;
  let phase = store.get("phase", 0);
  if (!(phase >= 0 && phase < PHASES.length)) phase = 0;
  // Open today's workout, or on a non-gym day the next one coming up.
  const nextWorkout = [1, 2, 3, 4, 5, 6].map((n) => WEEK[(todayIndex + n) % 7].workout).find(Boolean);
  let current = todayWorkout || nextWorkout;
  if (!WORKOUTS[current]) current = "A";

  // ---- Rendering --------------------------------------------------------------

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  function renderWeek() {
    const list = document.getElementById("week");
    WEEK.forEach((d, i) => {
      const item = el("li", { class: `day ${d.kind}${i === todayIndex ? " today" : ""}` },
        el("span", { class: "day-name" }, d.day),
        el("span", { class: "day-what" }, d.what),
        i === todayIndex ? el("span", { class: "today-tag" }, "Today") : null);
      if (d.workout) {
        item.classList.add("clickable");
        item.addEventListener("click", () => select(d.workout, true));
      }
      list.append(item);
    });
  }

  function renderPhases() {
    const picker = document.getElementById("phase-picker");
    picker.replaceChildren(...PHASES.map((p, i) =>
      el("button", {
        class: "chip" + (i === phase ? " active" : ""),
        role: "radio",
        "aria-checked": String(i === phase),
        onclick: () => {
          phase = i;
          store.set("phase", i);
          renderPhases();
          renderWorkout();
        },
      }, el("strong", {}, p.name), el("span", {}, p.label))));
    document.getElementById("phase-note").textContent = PHASES[phase].note;
  }

  function renderTabs() {
    const tabs = document.getElementById("tabs");
    tabs.replaceChildren(...Object.keys(WORKOUTS).map((key) =>
      el("button", {
        class: "tab" + (key === current ? " active" : ""),
        role: "tab",
        "aria-selected": String(key === current),
        onclick: () => select(key, false),
      }, WORKOUTS[key].title, key === todayWorkout ? el("span", { class: "tab-today" }, "today") : null)));
  }

  function select(key, scroll) {
    current = key;
    renderTabs();
    renderWorkout();
    if (scroll) document.getElementById("tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const doneKey = (w, i) => `done:${w}:${i}`;

  function setCircles(w, i, count) {
    const done = store.get(doneKey(w, i), []);
    const wrap = el("div", { class: "sets", "aria-label": "Sets" });
    for (let s = 0; s < count; s++) {
      const on = done.includes(s);
      wrap.append(el("button", {
        class: "set" + (on ? " done" : ""),
        "aria-pressed": String(on),
        "aria-label": `Set ${s + 1}`,
        onclick: (e) => {
          const list = store.get(doneKey(w, i), []);
          const idx = list.indexOf(s);
          if (idx >= 0) list.splice(idx, 1);
          else list.push(s);
          store.set(doneKey(w, i), list);
          const btn = e.currentTarget;
          btn.classList.toggle("done", idx < 0);
          btn.setAttribute("aria-pressed", String(idx < 0));
        },
      }, String(s + 1)));
    }
    return wrap;
  }

  function block(title, minutes, items) {
    return el("details", { class: "block" },
      el("summary", {}, el("span", {}, title), el("span", { class: "mins" }, minutes)),
      el("ul", {}, ...items.map((t) => el("li", {}, t))));
  }

  function renderWorkout() {
    const w = WORKOUTS[current];
    const root = document.getElementById("workout");
    const groups = [];
    let last = null;
    w.exercises.forEach((ex, i) => {
      if (ex.pair !== last) {
        last = ex.pair;
        const members = w.exercises.filter((e) => e.pair === ex.pair).length;
        groups.push(el("h3", { class: "pair-head" },
          members > 1 ? `Pair ${ex.pair} — alternate, rest 60–90 s after each round` : `Finisher — rest 45–60 s between sets`));
      }
      const sets = ex.sets[phase];
      groups.push(el("article", { class: "exercise" },
        el("div", { class: "ex-top" },
          el("h4", {}, ex.name),
          el("span", { class: "dose" }, `${sets} × ${ex.reps}`)),
        el("p", { class: "how" }, ex.how),
        ex.knee ? el("p", { class: "knee" }, el("strong", {}, "Knees: "), ex.knee) : null,
        ex.swap ? el("p", { class: "swap" }, el("strong", {}, "If it bothers your knees: "), ex.swap) : null,
        setCircles(current, i, sets)));
    });

    root.replaceChildren(
      el("p", { class: "focus" }, w.focus),
      block("Warm-up", "10 min", WARMUP),
      el("div", { class: "block-label" }, el("span", {}, "Strength"), el("span", { class: "mins" }, "≈ 40 min")),
      ...groups,
      block("Cool-down stretches", "10 min", COOLDOWN),
      el("button", {
        class: "reset",
        onclick: () => {
          w.exercises.forEach((_, i) => store.set(doneKey(current, i), []));
          renderWorkout();
        },
      }, `Clear ${w.title} check marks`));
  }

  renderWeek();
  renderPhases();
  renderTabs();
  renderWorkout();
})();
