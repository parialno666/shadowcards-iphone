const KEYS = {
  decks: "shadowcards:decks:v2",
  reviews: "shadowcards:reviews:v2",
  activeDeck: "shadowcards:active-deck:v2",
  legacyDeck: "shadowcards:deck:v1",
  legacyReviews: "shadowcards:reviews:v1",
  preferences: "shadowcards:preferences:v1",
};

const $ = (id) => document.getElementById(id);
const views = ["emptyView", "libraryView", "homeView", "studyView", "settingsView"];
let decks = read(KEYS.decks, []);
let reviewsByDeck = read(KEYS.reviews, {});
let activeDeckId = read(KEYS.activeDeck, null);
let deck = null;
let reviews = {};
let preferences = {
  rate: 0.78,
  voices: {},
  voiceNames: {},
  ...read(KEYS.preferences, {}),
};
preferences.voices ||= {};
preferences.voiceNames ||= {};
let studyCards = [];
let index = 0;

function createDeckId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function migrateLegacyDeck() {
  if (decks.length) return;
  const legacyDeck = read(KEYS.legacyDeck, null);
  if (!legacyDeck?.cards?.length) return;
  const id = createDeckId();
  decks = [{ ...legacyDeck, id }];
  reviewsByDeck = { [id]: read(KEYS.legacyReviews, {}) };
  activeDeckId = id;
  write(KEYS.decks, decks);
  write(KEYS.reviews, reviewsByDeck);
  write(KEYS.activeDeck, activeDeckId);
}

function syncActiveDeck() {
  deck = decks.find((item) => item.id === activeDeckId) || decks[0] || null;
  activeDeckId = deck?.id || null;
  reviews = activeDeckId ? (reviewsByDeck[activeDeckId] ||= {}) : {};
}

migrateLegacyDeck();
migrateGenericLessonNames();
syncActiveDeck();

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
  const voices = speechSynthesis.getVoices();
  const selectedVoiceURI = preferences.voices?.[lang];
  if (selectedVoiceURI) {
    const selected = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
    if (selected) return selected;
  }
  const selectedVoiceName = preferences.voiceNames?.[lang];
  if (selectedVoiceName) {
    const selected = voices.find(
      (voice) =>
        voice.name === selectedVoiceName &&
        normalizeVoiceLanguage(voice.lang).split("-")[0] ===
          normalizeVoiceLanguage(lang).split("-")[0],
    );
    if (selected) return selected;
  }
  return matchingVoices(lang)[0];
}

function loadVoiceSelectors() {
  if (!("speechSynthesis" in window)) return;
  Object.values(SPEECH_LANGUAGES).forEach(({ lang, select }) => {
    const element = $(select);
    const previousValue = preferences.voices?.[lang] || "";
    const previousName = preferences.voiceNames?.[lang] || "";
    const voices = matchingVoices(lang);
    element.replaceChildren(new Option("انتخاب خودکار بهترین صدا", ""));
    voices.forEach((voice) => {
      element.add(new Option(`${voice.name} — ${voice.lang}`, voice.voiceURI));
    });
    const savedVoice =
      voices.find((voice) => voice.voiceURI === previousValue) ||
      voices.find((voice) => voice.name === previousName);
    if (savedVoice) {
      element.value = savedVoice.voiceURI;
      preferences.voices[lang] = savedVoice.voiceURI;
      preferences.voiceNames[lang] = savedVoice.name;
      write(KEYS.preferences, preferences);
    } else {
      element.value = "";
    }
  });
  const hasTurkishVoice = matchingVoices("tr-TR").length > 0;
  $("turkishVoiceHelp").textContent = missingTurkishVoiceMessage();
  $("turkishVoiceHelp").classList.toggle("hidden", hasTurkishVoice);
}

function cardId(card) {
  return card.english.trim().toLowerCase();
}

function cleanLessonName(value) {
  return String(value || "")
    .replace(/\.(shadow|json)$/i, "")
    .replace(/^\s*\d+\s*[-_.—–]*\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericLessonName(value) {
  return ["my lesson", "lesson", "new lesson", "درس جدید"].includes(
    cleanLessonName(value).toLowerCase(),
  );
}

function inferredLessonName(cards) {
  const opening = (cards || [])
    .slice(0, 5)
    .map((card) => card?.english?.trim().toLowerCase().replace(/[.!?]+$/g, ""))
    .filter(Boolean);
  if (opening.includes("i just woke up") || opening.includes("i'm awake now")) {
    return "Wake Up";
  }
  return "";
}

function lessonNameFromFile(filename, cards = [], embeddedName = "") {
  const fileName = cleanLessonName(filename);
  const savedName = cleanLessonName(embeddedName);
  const preferredName = savedName && !isGenericLessonName(savedName) ? savedName : fileName;
  if (!preferredName || isGenericLessonName(preferredName)) {
    return inferredLessonName(cards) || preferredName || "درس جدید";
  }
  return preferredName;
}

function migrateGenericLessonNames() {
  let changed = false;
  decks = decks.map((item) => {
    if (!isGenericLessonName(item.name)) return item;
    const inferredName = inferredLessonName(item.cards);
    if (!inferredName) return item;
    changed = true;
    return { ...item, name: inferredName };
  });
  if (changed) write(KEYS.decks, decks);
}

function persistLessons() {
  if (activeDeckId) reviewsByDeck[activeDeckId] = reviews;
  write(KEYS.decks, decks);
  write(KEYS.reviews, reviewsByDeck);
  write(KEYS.activeDeck, activeDeckId);
}

function faNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function show(view) {
  views.forEach((id) => $(id).classList.toggle("hidden", id !== view));
  document.querySelector(".app").classList.toggle("study-mode", view === "studyView");
  if (view === "studyView") $("notice").classList.add("hidden");
  $("settingsButton").classList.toggle("hidden", !decks.length || view === "studyView");
  if (view === "libraryView") renderLibrary();
  if (view === "homeView") renderHome();
}

function message(text) {
  $("notice").textContent = text;
  $("notice").classList.remove("hidden");
}

function normalizeCard(item) {
  if (!item || typeof item !== "object" || typeof item.english !== "string" || !item.english.trim()) return null;
  const pronunciation =
    item.french_pronunciation_fa ??
    item.frenchPronunciationFa ??
    item.pronunciation_fa ??
    item.pronunciationFa ??
    item.french_pronunciation_persian ??
    item.persian_pronunciation ??
    item.pronunciation_segmented_fa ??
    item.segmented_pronunciation ??
    item.french_pronunciation ??
    item.pronunciation ??
    "";
  const rawParts =
    item.french_parts ??
    item.frenchWordBreakdown ??
    item.french_word_breakdown ??
    item.word_by_word ??
    item.wordByWord ??
    item.wordBreakdown ??
    item.french_word_parts ??
    item.french_tokens ??
    item.french_analysis ??
    item.french_breakdown ??
    item.breakdown ??
    [];
  return {
    english: item.english.trim(),
    persian: typeof item.persian === "string" ? item.persian.trim() : "",
    turkish: typeof item.turkish === "string" ? item.turkish.trim() : "",
    french: typeof item.french === "string" ? item.french.trim() : "",
    french_pronunciation_fa: typeof pronunciation === "string" ? pronunciation.trim() : "",
    french_parts: normalizeFrenchParts(rawParts),
  };
}

const FRENCH_CONTRACTIONS = {
  "j'": [["Je", "I"], ["ai", "have"]],
  "c'": [["ce", "it / this"], ["est", "is"]],
  "d'": [["de", "of / from"], ["", ""]],
  "l'": [["le / la", "the"], ["", ""]],
  "m'": [["me", "myself / me"], ["", ""]],
  "t'": [["te", "yourself / you"], ["", ""]],
  "s'": [["se", "oneself"], ["", ""]],
  "n'": [["ne", "not"], ["", ""]],
  "qu'": [["que", "that / which"], ["", ""]],
  du: [["de", "of / from"], ["le", "the"]],
  au: [["à", "to / at"], ["le", "the"]],
  aux: [["à", "to / at"], ["les", "the"]],
  des: [["de", "of / from"], ["les", "the"]],
};

const FRENCH_COMPOUNDS = {
  "j'ai": [["Je", "I"], ["ai", "have"]],
  "c'est": [["ce", "it / this"], ["est", "is"]],
  "n'ai": [["ne", "not"], ["ai", "have"]],
  "m'appelle": [["me", "myself"], ["appelle", "call"]],
  "t'appelles": [["te", "yourself"], ["appelles", "call"]],
  "s'appelle": [["se", "oneself"], ["appelle", "call"]],
};

function cleanPartValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function expandFrenchComponent(component, surface = "") {
  const french = cleanPartValue(component?.fr ?? component?.french ?? component?.word ?? component?.token);
  const english = cleanPartValue(component?.en ?? component?.english ?? component?.meaning ?? component?.gloss);
  if (!french) return [];

  const lower = french.toLocaleLowerCase("fr").replaceAll("’", "'");
  if (FRENCH_COMPOUNDS[lower]) {
    return FRENCH_COMPOUNDS[lower].map(([fr, en], index) => ({
      fr,
      en,
      surface: index === 0 ? (surface || french) : "",
    }));
  }
  if (FRENCH_CONTRACTIONS[lower] && !french.includes("'")) {
    return FRENCH_CONTRACTIONS[lower].map(([fr, fallbackEnglish], index) => ({
      fr,
      en: index === 0 && english && !fallbackEnglish ? english : fallbackEnglish,
      surface: index === 0 ? (surface || french) : "",
    }));
  }

  const apostropheIndex = french.search(/['’]/);
  if (apostropheIndex > -1 && apostropheIndex < french.length - 1) {
    const prefix = `${french.slice(0, apostropheIndex).toLocaleLowerCase("fr")}'`;
    const expansion = FRENCH_CONTRACTIONS[prefix];
    if (expansion) {
      const stem = french.slice(apostropheIndex + 1);
      return [
        { fr: expansion[0][0], en: expansion[0][1], surface: surface || french },
        { fr: stem, en: english || expansion[1]?.[1] || "", surface: "" },
      ];
    }
  }

  return [{ fr: french, en: english, surface }];
}

function normalizeFrenchParts(rawParts) {
  if (!rawParts) return [];
  if (!Array.isArray(rawParts) && typeof rawParts === "object") {
    rawParts = rawParts.parts ?? rawParts.items ?? rawParts.tokens ?? rawParts.components ?? rawParts;
  }
  if (!Array.isArray(rawParts) && typeof rawParts === "object") {
    rawParts = Object.entries(rawParts).map(([fr, en]) => ({ fr, en }));
  }
  if (typeof rawParts === "string") {
    rawParts = rawParts
      .split(/\r?\n/)
      .map((line) => line.split(/\s*(?:→|=>|=|\|)\s*/))
      .filter((pair) => pair[0])
      .map(([fr, en = ""]) => ({ fr, en }));
  }
  if (!Array.isArray(rawParts)) return [];

  return rawParts.flatMap((part) => {
    if (!part) return [];
    if (typeof part === "string") {
      const [fr, en = ""] = part.split(/\s*(?:→|=>|=|\|)\s*/);
      return expandFrenchComponent({ fr, en });
    }

    const surface = cleanPartValue(part.surface);
    if (Array.isArray(part.components)) {
      return part.components.flatMap((component, componentIndex) =>
        expandFrenchComponent(component, componentIndex === 0 ? surface : ""),
      );
    }
    return expandFrenchComponent(part, surface);
  });
}

async function importFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cards) ? parsed.cards : [];
    const cards = source.map(normalizeCard).filter(Boolean);
    if (!cards.length) throw new Error("empty");
    const name = lessonNameFromFile(
      file.name,
      cards,
      parsed.name || parsed.lesson_name || parsed.title || "",
    );
    const existing = decks.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`درسی با نام «${name}» وجود دارد. فایل جدید جایگزین همان درس شود؟`)) {
      message("ورود فایل لغو شد و درس قبلی بدون تغییر باقی ماند.");
      return;
    }

    if (existing) {
      decks = decks.map((item) =>
        item.id === existing.id
          ? { ...item, name, cards, importedAt: Date.now() }
          : item,
      );
      activeDeckId = existing.id;
    } else {
      const newDeck = {
        id: createDeckId(),
        name,
        cards,
        importedAt: Date.now(),
      };
      decks = [newDeck, ...decks];
      activeDeckId = newDeck.id;
    }

    syncActiveDeck();
    persistLessons();
    index = 0;
    message(`درس «${name}» با ${faNumber(cards.length)} فلش‌کارت اضافه شد.`);
    show("libraryView");
  } catch {
    message("این فایل قابل خواندن نیست. فایل خروجی برنامه ویندوز را انتخاب کن.");
  }
}

function renderLibrary() {
  if (!decks.length) return show("emptyView");
  const now = Date.now();
  const totalCards = decks.reduce((sum, item) => sum + item.cards.length, 0);
  const totalLearned = decks.reduce((sum, item) => {
    const deckReviews = reviewsByDeck[item.id] || {};
    return sum + item.cards.filter((card) => (deckReviews[cardId(card)]?.seen || 0) > 0).length;
  }, 0);

  $("librarySummary").textContent =
    `${faNumber(decks.length)} درس، ${faNumber(totalCards)} فلش‌کارت و ${faNumber(totalLearned)} کارت مرورشده`;
  $("lessonList").replaceChildren();

  decks.forEach((item) => {
    const deckReviews = reviewsByDeck[item.id] || {};
    const learned = item.cards.filter((card) => (deckReviews[cardId(card)]?.seen || 0) > 0).length;
    const due = item.cards.filter((card) => (deckReviews[cardId(card)]?.due || 0) <= now).length;
    const progress = item.cards.length ? Math.round((learned / item.cards.length) * 100) : 0;

    const lessonCard = document.createElement("article");
    lessonCard.className = "lesson-card";

    const openButton = document.createElement("button");
    openButton.className = "lesson-open";
    openButton.type = "button";
    openButton.dataset.lessonId = item.id;
    openButton.setAttribute("aria-label", `باز کردن درس ${item.name}`);

    const copy = document.createElement("span");
    copy.className = "lesson-copy";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const meta = document.createElement("span");
    meta.className = "lesson-meta";
    const cardCount = document.createElement("span");
    cardCount.textContent = `${faNumber(item.cards.length)} کارت`;
    const dueCount = document.createElement("span");
    dueCount.textContent = `${faNumber(due)} آمادهٔ مرور`;
    const importedAt = document.createElement("span");
    importedAt.textContent = new Date(item.importedAt).toLocaleDateString("fa-IR");
    meta.append(cardCount, dueCount, importedAt);
    copy.append(title, meta);

    const progressRing = document.createElement("span");
    progressRing.className = "lesson-progress";
    progressRing.style.setProperty("--lesson-progress", `${progress * 3.6}deg`);
    const progressText = document.createElement("span");
    progressText.textContent = `${faNumber(progress)}٪`;
    progressRing.append(progressText);

    openButton.append(copy, progressRing);

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-lesson";
    deleteButton.type = "button";
    deleteButton.dataset.deleteLessonId = item.id;
    deleteButton.setAttribute("aria-label", `حذف درس ${item.name}`);
    deleteButton.textContent = "حذف درس";

    lessonCard.append(openButton, deleteButton);
    $("lessonList").append(lessonCard);
  });
}

function openLesson(id) {
  if (!decks.some((item) => item.id === id)) return;
  if (activeDeckId) reviewsByDeck[activeDeckId] = reviews;
  activeDeckId = id;
  syncActiveDeck();
  write(KEYS.activeDeck, activeDeckId);
  setStudyStart();
  show("homeView");
}

function deleteLesson(id) {
  const lesson = decks.find((item) => item.id === id);
  if (!lesson) return;
  if (!confirm(`درس «${lesson.name}» و تمام پیشرفت آن حذف شود؟`)) return;

  decks = decks.filter((item) => item.id !== id);
  delete reviewsByDeck[id];

  if (activeDeckId === id) {
    activeDeckId = decks[0]?.id || null;
  }

  syncActiveDeck();
  setStudyStart();
  persistLessons();
  message(`درس «${lesson.name}» حذف شد.`);
  show(decks.length ? "libraryView" : "emptyView");
}

function setStudyStart() {
  studyCards = [];
  index = 0;
  $("cardFront").classList.remove("hidden");
  $("cardBack").classList.add("hidden");
  $("ratings").classList.add("hidden");
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
  studyCards = [...deck.cards];
  index = 0;
  show("studyView");
  renderCard(false);
}

function currentCard() {
  return studyCards[index % studyCards.length];
}

function fitPersianText() {
  const element = $("persianText");
  const length = Array.from(element.textContent || "").length;
  let size = length > 95 ? 24 : length > 60 ? 31 : 40;
  element.style.fontSize = `${size}px`;

  while (size > 14) {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    if (element.scrollHeight <= lineHeight * 2 + 2) break;
    size -= 1;
    element.style.fontSize = `${size}px`;
  }
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
  $("pronunciationBlock").classList.toggle("hidden", !card.french_pronunciation_fa);
  $("cardFront").classList.toggle("hidden", revealed);
  $("cardBack").classList.toggle("hidden", !revealed);
  $("ratings").classList.toggle("hidden", !revealed);
  if (!revealed) fitPersianText();
  renderBreakdown(card.french_parts);
}

function renderBreakdown(parts) {
  parts = normalizeFrenchParts(parts);
  $("breakdown").replaceChildren();
  (parts || []).forEach((part) => {
    const item = document.createElement("span");
    item.className = "word";
    if (part.surface && part.surface !== part.fr) {
      const surface = document.createElement("em");
      surface.textContent = part.surface;
      item.append(surface);
    }
    const french = document.createElement("b");
    french.textContent = part.fr;
    const english = document.createElement("small");
    english.textContent = part.en || "—";
    item.append(french, english);
    $("breakdown").append(item);
  });
  $("breakdownSection").classList.toggle("hidden", !(parts || []).length);
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

function rateCard(rating, advance = true) {
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
  reviewsByDeck[activeDeckId] = reviews;
  write(KEYS.reviews, reviewsByDeck);
  if (advance) {
    index = (index + 1) % studyCards.length;
    renderCard(false);
  }
}

function answerFront(answer) {
  if (answer === "known") {
    rateCard("easy", false);
    studyCards.splice(index, 1);
    if (!studyCards.length) {
      setStudyStart();
      show("homeView");
      return;
    }
    if (index >= studyCards.length) index = 0;
    renderCard(false);
    return;
  }
  if (answer === "forgot") {
    rateCard("again", false);
    renderCard(true);
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "import") $("fileInput").click();
  if (action === "home" || action === "library") show(decks.length ? "libraryView" : "emptyView");
  if (action === "settings") show("settingsView");
  if (action === "study") startStudy();
  if (action === "reset" && deck && confirm(`پیشرفت یادگیری درس «${deck.name}» پاک شود؟`)) {
    reviews = {};
    reviewsByDeck[activeDeckId] = reviews;
    write(KEYS.reviews, reviewsByDeck);
    message("پیشرفت این درس پاک شد.");
    show("homeView");
  }
  if (target.dataset.deleteLessonId) deleteLesson(target.dataset.deleteLessonId);
  if (target.dataset.lessonId) openLesson(target.dataset.lessonId);
  if (target.dataset.speak) speak(target.dataset.speak, target);
  if (target.dataset.answer) answerFront(target.dataset.answer);
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
    const selectedVoice = speechSynthesis
      .getVoices()
      .find((voice) => voice.voiceURI === event.target.value);
    preferences.voiceNames[lang] = selectedVoice?.name || "";
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

$("saveSettings").addEventListener("click", () => {
  preferences.rate = Number($("rateRange").value);
  Object.values(SPEECH_LANGUAGES).forEach(({ lang, select }) => {
    const voiceURI = $(select).value;
    const selectedVoice = speechSynthesis
      .getVoices()
      .find((voice) => voice.voiceURI === voiceURI);
    preferences.voices[lang] = voiceURI;
    preferences.voiceNames[lang] = selectedVoice?.name || preferences.voiceNames[lang] || "";
  });
  write(KEYS.preferences, preferences);
  const button = $("saveSettings");
  button.textContent = "تنظیمات ذخیره شد ✓";
  button.classList.add("saved");
  window.setTimeout(() => {
    button.textContent = "ذخیره تنظیمات";
    button.classList.remove("saved");
  }, 1800);
});

function persistAppState() {
  persistLessons();
  write(KEYS.preferences, preferences);
}

window.addEventListener("pagehide", persistAppState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistAppState();
});

if ("speechSynthesis" in window) {
  loadVoiceSelectors();
  speechSynthesis.addEventListener("voiceschanged", loadVoiceSelectors);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
show(decks.length ? "libraryView" : "emptyView");
