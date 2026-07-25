const KEYS = {
  deck: "shadowcards:deck:v1",
  reviews: "shadowcards:reviews:v1",
  preferences: "shadowcards:preferences:v1",
};

const $ = (id) => document.getElementById(id);
const views = ["emptyView", "homeView", "studyView", "settingsView"];
let deck = read(KEYS.deck, null);
let reviews = read(KEYS.reviews, {});
let preferences = {
  rate: 0.78,
  voices: {},
  ...read(KEYS.preferences, {}),
};
preferences.voices ||= {};
let studyCards = [];
let index = 0;

const SPEECH_LANGUAGES = {
  english: { lang: "en-US", select: "voiceEnglish", sample: "Learning a language takes time and practice." },
  turkish: { lang: "tr-TR", select: "voiceTurkish", sample: "Bugün Türkçe çalışıyorum." },
  french: { lang: "fr-FR", select: "voiceFrench", sample: "J'apprends le français chaque jour." },
};

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeVoiceLanguage(value) {
  return value.replaceAll("_", "-").toLowerCase();
}

function missingTurkishVoiceMessage() {
  const device = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (device.includes("windows") || device.includes("win32")) {
    return "صدای ترکی روی ویندوز نصب نیست. در تنظیمات ویندوز، بخش Time & language و سپس Language & region، زبان Turkish و صدای آن را نصب کن و مرورگر را دوباره باز کن.";
  }
  if (/iphone|ipad|ipod/.test(device) || (device.includes("mac") && navigator.maxTouchPoints > 1)) {
    return "صدای ترکی روی آیفون پیدا نشد. در تنظیمات آیفون، بخش Accessibility و سپس Spoken Content، صدای Turkish را دانلود کن و برنامه را دوباره باز کن.";
  }
  return "صدای ترکی روی این دستگاه نصب نیست. صدای Turkish را در تنظیمات دستگاه نصب کن و برنامه را دوباره باز کن.";
}

function matchingVoices(lang) {
  const target = normalizeVoiceLanguage(lang);
  const base = target.split("-")[0];
  return speechSynthesis
    .getVoices()
    .filter((voice) => {
      const voiceLanguage = normalizeVoiceLanguage(voice.lang);
      return voiceLanguage === target || voiceLanguage.split("-")[0] === base;
    })
    .sort((first, second) => {
      const firstExact = normalizeVoiceLanguage(first.lang) === target ? 1 : 0;
      const secondExact = normalizeVoiceLanguage(second.lang) === target ? 1 : 0;
      if (firstExact !== secondExact) return secondExact - firstExact;
      if (first.localService !== second.localService) return first.localService ? -1 : 1;
      return first.name.localeCompare(second.name);
    });
}

function pickVoice(lang) {
  const selectedVoiceURI = preferences.voices?.[lang];
  if (selectedVoiceURI) {
    const selected = speechSynthesis.getVoices().find((voice) => voice.voiceURI === selectedVoiceURI);
    if (selected) return selected;
  }
  return matchingVoices(lang)[0];
}

function loadVoiceSelectors() {
  if (!("speechSynthesis" in window)) return;
  Object.values(SPEECH_LANGUAGES).forEach(({ lang, select }) => {
    const element = $(select);
    const previousValue = preferences.voices?.[lang] || "";
    element.replaceChildren(new Option("انتخاب خودکار بهترین صدا", ""));
    matchingVoices(lang).forEach((voice) => {
      element.add(new Option(`${voice.name} — ${voice.lang}`, voice.voiceURI));
    });
    element.value = previousValue;
    if (!element.value) {
      preferences.voices[lang] = "";
    }
  });
  const hasTurkishVoice = matchingVoices("tr-TR").length > 0;
  $("turkishVoiceHelp").textContent = missingTurkishVoiceMessage();
  $("turkishVoiceHelp").classList.toggle("hidden", hasTurkishVoice);
}

function cardId(card) {
  return card.english.trim().toLowerCase();
}

function faNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function show(view) {
  views.forEach((id) => $(id).classList.toggle("hidden", id !== view));
  $("settingsButton").classList.toggle("hidden", !deck || view === "studyView");
  if (view === "homeView") renderHome();
}

function message(text) {
  $("notice").textContent = text;
  $("notice").classList.remove("hidden");
}

function normalizeCard(item) {
  if (!item || typeof item !== "object" || typeof item.english !== "string" || !item.english.trim()) return null;
  return {
    english: item.english.trim(),
    persian: typeof item.persian === "string" ? item.persian.trim() : "",
    turkish: typeof item.turkish === "string" ? item.turkish.trim() : "",
    french: typeof item.french === "string" ? item.french.trim() : "",
    french_pronunciation_fa: typeof item.french_pronunciation_fa === "string" ? item.french_pronunciation_fa.trim() : "",
    french_parts: Array.isArray(item.french_parts) ? item.french_parts : [],
  };
}

async function importFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cards) ? parsed.cards : [];
    const cards = source.map(normalizeCard).filter(Boolean);
    if (!cards.length) throw new Error("empty");
    deck = { name: file.name.replace(/\.(shadow|json)$/i, ""), cards, importedAt: Date.now() };
    reviews = {};
    write(KEYS.deck, deck);
    write(KEYS.reviews, reviews);
    message(`${faNumber(cards.length)} فلش‌کارت با موفقیت وارد شد.`);
    show("homeView");
  } catch {
    message("این فایل قابل خواندن نیست. فایل خروجی برنامه ویندوز را انتخاب کن.");
  }
}

function renderHome() {
  if (!deck) return show("emptyView");
  const now = Date.now();
  const learned = deck.cards.filter((card) => (reviews[cardId(card)]?.seen || 0) > 0).length;
  const due = deck.cards.filter((card) => (reviews[cardId(card)]?.due || 0) <= now).length;
  const progress = Math.round((learned / deck.cards.length) * 100);
  $("deckName").textContent = deck.name;
  $("dueMessage").textContent = `${faNumber(due)} کارت آماده تمرین داری.`;
  $("totalCount").textContent = faNumber(deck.cards.length);
  $("learnedCount").textContent = faNumber(learned);
  $("dueCount").textContent = faNumber(due);
  $("progressText").textContent = `${faNumber(progress)}٪`;
  $("progressRing").style.setProperty("--progress", `${progress * 3.6}deg`);
  $("importDate").textContent = new Date(deck.importedAt).toLocaleDateString("fa-IR");
}

function startStudy() {
  if (!deck) return;
  const now = Date.now();
  const due = deck.cards.filter((card) => (reviews[cardId(card)]?.due || 0) <= now);
  studyCards = due.length ? due : deck.cards;
  index = 0;
  show("studyView");
  renderCard(false);
}

function currentCard() {
  return studyCards[index % studyCards.length];
}

function renderCard(revealed) {
  const card = currentCard();
  $("studyCounter").textContent = `${faNumber(index + 1)} از ${faNumber(studyCards.length)}`;
  $("studyBar").style.width = `${((index + 1) / studyCards.length) * 100}%`;
  $("persianText").textContent = card.persian || "ترجمه فارسی ثبت نشده است.";
  $("englishText").textContent = card.english;
  $("turkishText").textContent = card.turkish || "—";
  $("frenchText").textContent = card.french || "—";
  $("pronunciationText").textContent = card.french_pronunciation_fa || "";
  $("pronunciationText").classList.toggle("hidden", !card.french_pronunciation_fa);
  $("cardFront").classList.toggle("hidden", revealed);
  $("cardBack").classList.toggle("hidden", !revealed);
  $("ratings").classList.toggle("hidden", !revealed);
  renderBreakdown(card.french_parts);
}

function renderBreakdown(parts) {
  $("breakdown").replaceChildren();
  (parts || []).forEach((part) => {
    (part.components || []).forEach((component, componentIndex) => {
      const item = document.createElement("span");
      item.className = "word";
      if (componentIndex === 0 && part.surface && part.surface !== component.fr) {
        const surface = document.createElement("em");
        surface.textContent = part.surface;
        item.append(surface);
      }
      const french = document.createElement("b");
      french.textContent = component.fr;
      const english = document.createElement("small");
      english.textContent = component.en;
      item.append(french, english);
      $("breakdown").append(item);
    });
  });
}

function speak(field, button) {
  const card = currentCard();
  const config = {
    english: [card.english, "en-US"],
    turkish: [card.turkish, "tr-TR"],
    french: [card.french, "fr-FR"],
  }[field];
  if (!config || !config[0] || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(config[0]);
  utterance.lang = config[1];
  utterance.rate = preferences.rate;
  const voice = pickVoice(config[1]);
  if (!voice && config[1] === "tr-TR") {
    alert(missingTurkishVoiceMessage());
    return;
  }
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.onstart = () => button.classList.add("playing");
  utterance.onend = () => button.classList.remove("playing");
  utterance.onerror = () => button.classList.remove("playing");
  speechSynthesis.speak(utterance);
}

function rateCard(rating) {
  const card = currentCard();
  const key = cardId(card);
  const previous = reviews[key] || { due: 0, interval: 0, repetitions: 0, ease: 2.5, seen: 0 };
  let { interval, repetitions, ease } = previous;
  let due = Date.now();
  if (rating === "again") {
    interval = 0; repetitions = 0; ease = Math.max(1.3, ease - .2); due += 600000;
  } else if (rating === "hard") {
    interval = Math.max(1, Math.round((interval || 1) * 1.2)); ease = Math.max(1.3, ease - .15); due += interval * 86400000;
  } else if (rating === "good") {
    repetitions += 1; interval = repetitions === 1 ? 1 : repetitions === 2 ? 3 : Math.max(4, Math.round(interval * ease)); due += interval * 86400000;
  } else {
    repetitions += 1; ease += .15; interval = Math.max(4, Math.round((interval || 2) * ease * 1.3)); due += interval * 86400000;
  }
  reviews[key] = { due, interval, repetitions, ease, seen: previous.seen + 1 };
  write(KEYS.reviews, reviews);
  index = (index + 1) % studyCards.length;
  renderCard(false);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "import") $("fileInput").click();
  if (action === "home") show(deck ? "homeView" : "emptyView");
  if (action === "settings") show("settingsView");
  if (action === "study") startStudy();
  if (action === "reveal") renderCard(true);
  if (action === "reset" && confirm("همه پیشرفت‌های یادگیری پاک شوند؟")) {
    reviews = {}; write(KEYS.reviews, reviews); message("پیشرفت یادگیری پاک شد."); show("homeView");
  }
  if (target.dataset.speak) speak(target.dataset.speak, target);
  if (target.dataset.rate) rateCard(target.dataset.rate);
});

$("notice").addEventListener("click", () => $("notice").classList.add("hidden"));
$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importFile(file);
  event.target.value = "";
});
$("rateRange").value = preferences.rate;
$("rateValue").textContent = `${Number(preferences.rate).toFixed(2)}×`;
$("rateRange").addEventListener("input", (event) => {
  preferences.rate = Number(event.target.value);
  $("rateValue").textContent = `${preferences.rate.toFixed(2)}×`;
  write(KEYS.preferences, preferences);
});
$("voiceTest").addEventListener("click", () => {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance("Learning a language takes time and practice.");
  utterance.lang = "en-US";
  utterance.rate = preferences.rate;
  const voice = pickVoice("en-US");
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  speechSynthesis.speak(utterance);
});

Object.entries(SPEECH_LANGUAGES).forEach(([field, { lang, select, sample }]) => {
  $(select).addEventListener("change", (event) => {
    preferences.voices[lang] = event.target.value;
    write(KEYS.preferences, preferences);
  });
  $(`${select}Test`).addEventListener("click", (event) => {
    const button = event.currentTarget;
    const config = {
      english: [sample, "en-US"],
      turkish: [sample, "tr-TR"],
      french: [sample, "fr-FR"],
    }[field];
    if (!config) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(config[0]);
    utterance.lang = config[1];
    utterance.rate = preferences.rate;
    const voice = pickVoice(config[1]);
    if (!voice && config[1] === "tr-TR") {
      alert(missingTurkishVoiceMessage());
      return;
    }
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onstart = () => button.classList.add("playing");
    utterance.onend = () => button.classList.remove("playing");
    utterance.onerror = () => button.classList.remove("playing");
    speechSynthesis.speak(utterance);
  });
});

if ("speechSynthesis" in window) {
  loadVoiceSelectors();
  speechSynthesis.addEventListener("voiceschanged", loadVoiceSelectors);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
show(deck ? "homeView" : "emptyView");
