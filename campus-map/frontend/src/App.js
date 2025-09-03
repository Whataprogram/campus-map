// ===== Utilities =====
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const state = {
  userPos: null,
  data: [],
  filters: { q: "", category: "", amenities: new Set(), open: false, sort: "relevance" }
};

// Haversine (km)
function distanceKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function kmToMi(km) { return km * 0.621371; }

// Simple open-now check: daily open/close and days array
function isOpenNow(resource, when = new Date()) {
  if (!resource.hours) return false;
  const days = resource.hours.days || [];
  const dayStr = when.toLocaleDateString(undefined, { weekday: "short" }); // e.g., "Tue"
  if (!days.includes(dayStr)) return false;
  const toNum = t => parseInt(t.replace(":", ""), 10); // "08:30" -> 830
  const nowNum = when.getHours() * 100 + when.getMinutes();
  return toNum(resource.hours.open) <= nowNum && nowNum <= toNum(resource.hours.close);
}

// ===== Sample data (Oxford, OH – Miami University) =====
state.data = [
  {
    id: 1,
    name: "King Library – Quiet Study",
    category: "study",
    lat: 39.5094, lng: -84.7389,
    address: "151 S Campus Ave, Oxford, OH",
    amenities: ["quiet", "power", "printing", "accessible"],
    hours: { open: "08:00", close: "22:00", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] }
  },
  {
    id: 2,
    name: "Benton Hall – CS Lab",
    category: "lab",
    lat: 39.5067, lng: -84.7316,
    address: "510 E High St, Oxford, OH",
    amenities: ["computers", "power", "printing", "group"],
    hours: { open: "09:00", close: "21:00", days: ["Mon","Tue","Wed","Thu","Fri"] }
  },
  {
    id: 3,
    name: "Armstrong Student Center – Study Zones",
    category: "study",
    lat: 39.5091, lng: -84.7349,
    address: "550 E Spring St, Oxford, OH",
    amenities: ["group", "power", "accessible"],
    hours: { open: "07:00", close: "23:00", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] }
  },
  {
    id: 4,
    name: "Howe Writing Center – Tutoring",
    category: "tutoring",
    lat: 39.5093, lng: -84.7358,
    address: "King Library, Oxford, OH",
    amenities: ["quiet", "accessible"],
    hours: { open: "10:00", close: "18:00", days: ["Mon","Tue","Wed","Thu","Fri"] }
  },
  {
    id: 5,
    name: "Maplestreet Commons – Dining",
    category: "dining",
    lat: 39.5055, lng: -84.7303,
    address: "Maplestreet Station, Oxford, OH",
    amenities: ["accessible"],
    hours: { open: "08:00", close: "20:00", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] }
  },
  {
    id: 6,
    name: "Campus Services – Student Support",
    category: "service",
    lat: 39.5087, lng: -84.7401,
    address: "Shriver Center, Oxford, OH",
    amenities: ["accessible"],
    hours: { open: "09:00", close: "17:00", days: ["Mon","Tue","Wed","Thu","Fri"] }
  }
];

// ===== DOM refs =====
const el = {
  filterForm: $("#filterForm"),
  searchInput: $("#searchInput"),
  categorySelect: $("#categorySelect"),
  amenityInputs: $$('input[name="amenities"]'),
  openNow: $("#openNow"),
  sortSelect: $("#sortSelect"),
  resultsList: $("#resultsList"),
  resultsCount: $("#resultsCount"),
  detailDialog: $("#detailDialog"),
  detailBody: $("#detailBody"),
  closeDialog: $("#closeDialog"),
  toggleTheme: $("#toggleTheme")
};

// ===== Theme toggle (persisted) =====
(function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.dataset.theme = saved;
  el.toggleTheme.setAttribute("aria-pressed", saved === "dark" ? "false" : "true");
  el.toggleTheme.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme !== "light";
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    el.toggleTheme.setAttribute("aria-pressed", isDark ? "true" : "false");
  });
})();

// ===== Geolocation (optional for distance sorting) =====
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    pos => { state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude }; render(); },
    () => { /* ignore errors, still render */ render(); },
    { enableHighAccuracy: true, timeout: 4000 }
  );
} else {
  render();
}

// ===== Filtering and sorting =====
function getFiltersFromForm() {
  const formData = new FormData(el.filterForm);
  const amenities = new Set();
  el.amenityInputs.forEach(i => i.checked && amenities.add(i.value));
  return {
    q: (formData.get("q") || "").trim().toLowerCase(),
    category: formData.get("category") || "",
    amenities,
    open: !!formData.get("open"),
    sort: el.sortSelect.value
  };
}

function filterResources(items, f) {
  return items.filter(r => {
    const qMatch = !f.q || r.name.toLowerCase().includes(f.q) || r.address.toLowerCase().includes(f.q);
    const catMatch = !f.category || r.category === f.category;
    const amenityMatch = !f.amenities.size || [...f.amenities].every(a => r.amenities.includes(a));
    const openMatch = !f.open || isOpenNow(r);
    return qMatch && catMatch && amenityMatch && openMatch;
  });
}

function sortResources(items, f) {
  const arr = [...items];
  switch (f.sort) {
    case "name":
      arr.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "open":
      arr.sort((a, b) => Number(isOpenNow(b)) - Number(isOpenNow(a))); break;
    case "distance":
      if (!state.userPos) return arr; // no-op if we don't have location
      arr.sort((a, b) => {
        const da = distanceKm(state.userPos, a);
        const db = distanceKm(state.userPos, b);
        return da - db;
      });
      break;
    default:
      // relevance (very simple): shorter name match first, then open, then name
      arr.sort((a, b) => {
        const qa = state.filters.q;
        const sa = a.name.toLowerCase().indexOf(qa);
        const sb = b.name.toLowerCase().indexOf(qa);
        const scoreA = (sa === -1 ? 9999 : sa) - (isOpenNow(a) ? 10 : 0);
        const scoreB = (sb === -1 ? 9999 : sb) - (isOpenNow(b) ? 10 : 0);
        return scoreA - scoreB;
      });
  }
  return arr;
}

// ===== Render =====
function render() {
  state.filters = getFiltersFromForm();
  const filtered = filterResources(state.data, state.filters);
  const sorted = sortResources(filtered, state.filters);

  // Count
  el.resultsCount.textContent = `${sorted.length}`;

  // List
  el.resultsList.innerHTML = "";
  sorted.forEach(r => {
    const li = document.createElement("li");
    li.className = "card";
    const distMi = state.userPos ? kmToMi(distanceKm(state.userPos, r)) : null;
    const badges = [
      `<span class="badge">${r.category}</span>`,
      isOpenNow(r) ? `<span class="badge">Open</span>` : `<span class="badge">Closed</span>`,
      distMi != null ? `<span class="badge">${distMi.toFixed(1)} mi</span>` : ""
    ].filter(Boolean).join(" ");

    li.innerHTML = `
      <div class="title">${r.name}</div>
      <div class="meta">
        <span>${r.address}</span>
      </div>
      <div class="meta">${badges}</div>
      <div class="meta">${r.amenities.map(a => `<span class="badge">${a}</span>`).join(" ")}</div>
      <div><button class="btn" data-id="${r.id}">View details</button></div>
    `;
    el.resultsList.appendChild(li);
  });

  // Wire detail buttons
  $$("#resultsList .btn").forEach(btn => {
    btn.addEventListener("click", () => openDetail(parseInt(btn.dataset.id, 10)));
  });
}

function openDetail(id) {
  const r = state.data.find(x => x.id === id);
  if (!r) return;
  $("#detailTitle").textContent = r.name;
  el.detailBody.innerHTML = `
    <p><strong>Category:</strong> ${r.category}</p>
    <p><strong>Address:</strong> ${r.address}</p>
    <p><strong>Amenities:</strong> ${r.amenities.join(", ")}</p>
    <p><strong>Hours:</strong> ${r.hours.days.join(", ")} ${r.hours.open}–${r.hours.close} (${isOpenNow(r) ? "Open now" : "Closed now"})</p>
  `;
  $("#detailDialog").showModal();
}

el.closeDialog.addEventListener("click", () => $("#detailDialog").close());

// Events
el.filterForm.addEventListener("submit", (e) => { e.preventDefault(); render(); });
el.filterForm.addEventListener("reset", () => {
  setTimeout(() => { // wait for inputs to reset
    el.sortSelect.value = "relevance";
    render();
  }, 0);
});
el.sortSelect.addEventListener("change", render);
el.amenityInputs.forEach(i => i.addEventListener("change", render));
el.searchInput.addEventListener("input", () => {
  $("#status").textContent = "Filtering...";
  render();
  $("#status").textContent = "Updated";
});

// Initial render if geolocation doesn’t call render
setTimeout(() => { if (!el.resultsList.children.length) render(); }, 300);