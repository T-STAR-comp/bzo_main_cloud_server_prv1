"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFunFactsSeeded = ensureFunFactsSeeded;
exports.pickFunFactForUser = pickFunFactForUser;
exports.destinationLabel = destinationLabel;
exports.normalizeDestinationKey = normalizeDestinationKey;
const uuid_1 = require("uuid");
const pool_js_1 = require("../db/pool.js");
const logger_js_1 = require("../logger.js");
const AIRPORT_DESTINATION = {
    JNB: "south_africa",
    CPT: "south_africa",
    DUR: "south_africa",
    NBO: "kenya",
    MBA: "kenya",
    DXB: "uae",
    AUH: "uae",
    LHR: "united_kingdom",
    LGW: "united_kingdom",
    MAN: "united_kingdom",
    JFK: "united_states",
    EWR: "united_states",
    LAX: "united_states",
    CDG: "france",
    AMS: "netherlands",
    FRA: "germany",
    ADD: "ethiopia",
    DAR: "tanzania",
    ZNZ: "tanzania",
    HRE: "zimbabwe",
    LUN: "zambia",
    LAD: "angola",
    MAP: "mozambique",
    KGL: "rwanda",
    CAI: "egypt",
    IST: "turkey",
    BOM: "india",
    DEL: "india",
    SIN: "singapore",
    LLW: "malawi",
    BLZ: "malawi",
};
const SEED_FACTS = {
    south_africa: [
        "South Africa has three capital cities — Pretoria, Cape Town, and Bloemfontein.",
        "Table Mountain in Cape Town is one of the oldest mountains on Earth.",
        "South Africa is the only country to have hosted the Football, Cricket, and Rugby World Cups.",
        "The Cape Floral Kingdom contains over 9,000 plant species despite being the smallest floral kingdom.",
        "Johannesburg's OR Tambo is one of Africa's busiest airports.",
        "South Africa has 11 official languages — a reflection of its cultural diversity.",
    ],
    kenya: [
        "Kenya's Great Rift Valley is visible from space.",
        "Nairobi National Park is the only national park within a capital city's boundaries.",
        "The Maasai Mara hosts the Great Migration — millions of wildebeest crossing the plains.",
        "Kenya exports some of the world's most prized arabica coffee beans.",
        "Lake Victoria, partly in Kenya, is Africa's largest lake by area.",
    ],
    uae: [
        "Dubai's Burj Khalifa is the tallest building in the world at over 828 metres.",
        "Abu Dhabi's Sheikh Zayed Grand Mosque can hold over 40,000 worshippers.",
        "Less than 50 years ago, Dubai was largely desert — today's skyline rose remarkably fast.",
        "Arabic coffee with dates is a traditional welcome in Emirati culture.",
    ],
    united_kingdom: [
        "London's Underground, opened in 1863, is the world's oldest underground railway.",
        "The UK is made up of England, Scotland, Wales, and Northern Ireland.",
        "Tea culture runs deep — Britons drink an estimated 100 million cups daily.",
        "Scotland's Highlands are home to Loch Ness — famous worldwide.",
    ],
    united_states: [
        "The Statue of Liberty was a gift from France and welcomed millions of immigrants.",
        "Yellowstone was the world's first national park, established in 1872.",
        "Route 66 remains a symbol of American road-trip adventure.",
    ],
    tanzania: [
        "Mount Kilimanjaro is Africa's highest peak and the world's tallest free-standing mountain.",
        "The Serengeti hosts one of Earth's greatest wildlife spectacles.",
        "Zanzibar's Stone Town is a UNESCO World Heritage Site.",
    ],
    zambia: [
        "Victoria Falls — Mosi-oa-Tunya ('The Smoke That Thunders') — sits on the Zambia–Zimbabwe border.",
        "South Luangwa National Park pioneered walking safaris.",
    ],
    malawi: [
        "Malawi is known as 'The Warm Heart of Africa' for the friendliness of its people.",
        "Lake Malawi holds more fish species than any other lake on Earth.",
        "Malawi's tea-growing hills in Thyolo produce tea enjoyed across the region.",
    ],
    ethiopia: [
        "Ethiopia follows its own calendar — roughly seven years behind the Gregorian calendar.",
        "It is considered the birthplace of coffee.",
        "Ethiopia was never colonised — it maintained independence through the Scramble for Africa.",
    ],
    default: [
        "Travel opens the mind — every destination has stories waiting for you.",
        "Learning one local greeting before you land always earns a smile.",
        "Stay hydrated on long flights — cabin air is drier than most deserts.",
        "A light scarf is one of the most versatile items you can pack.",
    ],
};
function normalizeDestinationKey(destinationCode, destinationCity) {
    const code = destinationCode.toUpperCase().trim();
    if (AIRPORT_DESTINATION[code])
        return AIRPORT_DESTINATION[code];
    const city = destinationCity.toLowerCase();
    if (city.includes("johannesburg") || city.includes("cape town") || city.includes("durban"))
        return "south_africa";
    if (city.includes("nairobi") || city.includes("mombasa"))
        return "kenya";
    if (city.includes("dubai") || city.includes("abu dhabi"))
        return "uae";
    if (city.includes("london"))
        return "united_kingdom";
    if (city.includes("zanzibar") || city.includes("dar es salaam"))
        return "tanzania";
    if (city.includes("lilongwe") || city.includes("blantyre"))
        return "malawi";
    return `city:${city.replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`;
}
function destinationLabel(key, destinationCity) {
    const labels = {
        south_africa: "South Africa",
        kenya: "Kenya",
        uae: "the UAE",
        united_kingdom: "the United Kingdom",
        united_states: "the United States",
        tanzania: "Tanzania",
        zambia: "Zambia",
        malawi: "Malawi",
        ethiopia: "Ethiopia",
    };
    return labels[key] ?? destinationCity;
}
async function ensureFunFactsSeeded() {
    for (const [destinationKey, facts] of Object.entries(SEED_FACTS)) {
        for (const factText of facts) {
            const [existing] = await pool_js_1.pool.execute(`SELECT id FROM destination_fun_facts WHERE destination_key = :key AND fact_text = :text LIMIT 1`, { key: destinationKey, text: factText });
            if (existing[0])
                continue;
            await pool_js_1.pool.execute(`INSERT INTO destination_fun_facts (id, destination_key, fact_text) VALUES (:id, :key, :text)`, { id: (0, uuid_1.v4)(), key: destinationKey, text: factText });
        }
    }
    logger_js_1.logger.info("Destination fun facts seeded");
}
async function pickFunFactForUser(input) {
    const destinationKey = normalizeDestinationKey(input.destinationCode, input.destinationCity);
    const label = destinationLabel(destinationKey, input.destinationCity);
    let [candidates] = await pool_js_1.pool.execute(`SELECT f.id, f.fact_text FROM destination_fun_facts f
     WHERE f.destination_key = :key AND f.is_active = 1
     AND f.id NOT IN (
       SELECT fun_fact_id FROM fun_fact_deliveries
       WHERE user_id = :userId AND destination_key = :key AND fun_fact_id IS NOT NULL
     )
     ORDER BY RAND()
     LIMIT 1`, { key: destinationKey, userId: input.userId });
    if (!candidates[0]) {
        [candidates] = await pool_js_1.pool.execute(`SELECT f.id, f.fact_text FROM destination_fun_facts f
       WHERE f.destination_key = 'default' AND f.is_active = 1
       AND f.id NOT IN (
         SELECT fun_fact_id FROM fun_fact_deliveries
         WHERE user_id = :userId AND destination_key = 'default' AND fun_fact_id IS NOT NULL
       )
       ORDER BY RAND()
       LIMIT 1`, { userId: input.userId });
    }
    if (!candidates[0]) {
        [candidates] = await pool_js_1.pool.execute(`SELECT f.id, f.fact_text FROM destination_fun_facts f
       WHERE f.destination_key IN (:key, 'default') AND f.is_active = 1
       ORDER BY RAND()
       LIMIT 1`, { key: destinationKey });
    }
    const row = candidates[0];
    if (!row) {
        return { fact: SEED_FACTS.default[0], label, factId: null };
    }
    await pool_js_1.pool.execute(`INSERT INTO fun_fact_deliveries (id, user_id, destination_key, fun_fact_id, context)
     VALUES (:id, :userId, :key, :factId, :context)`, {
        id: (0, uuid_1.v4)(),
        userId: input.userId,
        key: destinationKey,
        factId: row.id,
        context: input.context,
    });
    return { fact: row.fact_text, label, factId: row.id };
}
