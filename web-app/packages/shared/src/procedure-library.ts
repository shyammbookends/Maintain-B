import type { StepInputType, WorkOrderCategory } from './enums.js'
import type { Locale } from './locales.js'

/*
 * Ready-made procedures for restaurant kitchens. "Add from library" copies one
 * into the organisation (in the chosen language), where it can be edited like
 * any other procedure. Conditions only use PASS / FAIL so they work in every
 * language.
 */

type Text = Record<Locale, string>

export interface LibraryStep {
  title: Text
  inputType: StepInputType
  unit?: string
  min?: number
  max?: number
  required?: boolean
  requirePhoto?: boolean
  /** Show only when step #step (1-based) is PASS / FAIL. */
  showIf?: { step: number; answer: 'PASS' | 'FAIL' }
}

export interface LibraryProcedure {
  key: string
  category: WorkOrderCategory
  name: Text
  description: Text
  steps: LibraryStep[]
}

const section = (en: string, hi: string, gu: string): LibraryStep => ({
  title: { en, hi, gu },
  inputType: 'SECTION',
  required: false,
})
const check = (en: string, hi: string, gu: string, extra: Partial<LibraryStep> = {}): LibraryStep => ({
  title: { en, hi, gu },
  inputType: 'PASS_FAIL_NA',
  ...extra,
})
const tick = (en: string, hi: string, gu: string): LibraryStep => ({
  title: { en, hi, gu },
  inputType: 'CHECKBOX',
})
const photoIfFail = (step: number, en: string, hi: string, gu: string): LibraryStep => ({
  title: { en, hi, gu },
  inputType: 'PHOTO',
  showIf: { step, answer: 'FAIL' },
})
const notes: LibraryStep = {
  title: { en: 'Notes', hi: 'नोट', gu: 'નોંધ' },
  inputType: 'TEXT',
  required: false,
}

export const PROCEDURE_LIBRARY: LibraryProcedure[] = [
  {
    key: 'walk-in-cooler',
    category: 'REFRIGERATION',
    name: {
      en: 'Walk-in cooler & freezer check',
      hi: 'वॉक-इन कूलर और फ्रीज़र जांच',
      gu: 'વૉક-ઇન કૂલર અને ફ્રીઝર તપાસ',
    },
    description: {
      en: 'Weekly: temperatures, door seals, coils and drains.',
      hi: 'साप्ताहिक: तापमान, दरवाज़े की सील, कॉइल और ड्रेन।',
      gu: 'સાપ્તાહિક: તાપમાન, દરવાજાની સીલ, કૉઇલ અને ડ્રેન.',
    },
    steps: [
      section('Temperature', 'तापमान', 'તાપમાન'),
      { title: { en: 'Cooler temperature', hi: 'कूलर का तापमान', gu: 'કૂલરનું તાપમાન' }, inputType: 'NUMBER', unit: '°C', min: 0, max: 5 },
      { title: { en: 'Freezer temperature', hi: 'फ्रीज़र का तापमान', gu: 'ફ્રીઝરનું તાપમાન' }, inputType: 'NUMBER', unit: '°C', min: -25, max: -15 },
      section('Condition', 'हालत', 'સ્થિતિ'),
      check('Door gaskets seal properly', 'दरवाज़े की गैस्केट ठीक से बंद होती है', 'દરવાજાની ગાસ્કેટ બરાબર બંધ થાય છે'),
      photoIfFail(5, 'Photo of the damaged gasket', 'खराब गैस्केट की फोटो', 'ખરાબ ગાસ્કેટનો ફોટો'),
      check('Condenser coil is clean', 'कंडेंसर कॉइल साफ है', 'કન્ડેન્સર કૉઇલ સાફ છે'),
      check('Drain line clear (no ice or water)', 'ड्रेन लाइन साफ (बर्फ या पानी नहीं)', 'ડ્રેન લાઇન સાફ (બરફ કે પાણી નથી)'),
      notes,
    ],
  },
  {
    key: 'hood-filters',
    category: 'CLEANING',
    name: {
      en: 'Kitchen hood filter cleaning',
      hi: 'किचन हुड फ़िल्टर सफाई',
      gu: 'કિચન હૂડ ફિલ્ટર સફાઈ',
    },
    description: {
      en: 'Weekly degreasing of hood filters; reduces fire risk.',
      hi: 'हुड फ़िल्टर की साप्ताहिक चिकनाई सफाई; आग का खतरा कम होता है।',
      gu: 'હૂડ ફિલ્ટરની સાપ્તાહિક ચીકાશ સફાઈ; આગનું જોખમ ઘટે છે.',
    },
    steps: [
      tick('Burners and fryers under the hood are off', 'हुड के नीचे बर्नर और फ्रायर बंद हैं', 'હૂડ નીચે બર્નર અને ફ્રાયર બંધ છે'),
      tick('Filters removed and soaked in degreaser', 'फ़िल्टर निकालकर डीग्रीज़र में भिगोए', 'ફિલ્ટર કાઢીને ડીગ્રીઝરમાં પલાળ્યા'),
      check('Filters in good shape (no holes or bends)', 'फ़िल्टर ठीक हालत में (छेद या मोड़ नहीं)', 'ફિલ્ટર સારી સ્થિતિમાં (કાણાં કે વળાંક નથી)'),
      photoIfFail(3, 'Photo of the damaged filter', 'खराब फ़िल्टर की फोटो', 'ખરાબ ફિલ્ટરનો ફોટો'),
      tick('Grease cup emptied', 'ग्रीस कप खाली किया', 'ગ્રીસ કપ ખાલી કર્યો'),
      check('Filters refitted and fan tested', 'फ़िल्टर वापस लगाए और फैन चलाकर देखा', 'ફિલ્ટર પાછા લગાવ્યા અને ફેન ચલાવી જોયો'),
      { title: { en: 'After photo', hi: 'बाद की फोटो', gu: 'પછીનો ફોટો' }, inputType: 'PHOTO' },
    ],
  },
  {
    key: 'fryer-boil-out',
    category: 'KITCHEN_EQUIPMENT',
    name: { en: 'Fryer boil-out', hi: 'फ्रायर बॉयल-आउट', gu: 'ફ્રાયર બૉઇલ-આઉટ' },
    description: {
      en: 'Deep clean of a fryer and a thermostat check.',
      hi: 'फ्रायर की गहरी सफाई और थर्मोस्टैट जांच।',
      gu: 'ફ્રાયરની ઊંડી સફાઈ અને થર્મોસ્ટેટ તપાસ.',
    },
    steps: [
      tick('Fryer off, oil cooled below 50 °C', 'फ्रायर बंद, तेल 50 °C से ठंडा', 'ફ્રાયર બંધ, તેલ 50 °C થી ઠંડું'),
      tick('Oil drained', 'तेल निकाला', 'તેલ કાઢ્યું'),
      tick('Boiled out with cleaner for 20 minutes', 'क्लीनर के साथ 20 मिनट उबाला', 'ક્લીનર સાથે 20 મિનિટ ઉકાળ્યું'),
      tick('Rinsed and dried fully', 'धोकर पूरी तरह सुखाया', 'ધોઈને પૂરેપૂરું સૂકવ્યું'),
      { title: { en: 'Oil temperature at a 175 °C setting', hi: '175 °C सेटिंग पर तेल का तापमान', gu: '175 °C સેટિંગ પર તેલનું તાપમાન' }, inputType: 'NUMBER', unit: '°C', min: 170, max: 180 },
      check('Burner flame is blue and even', 'बर्नर की लौ नीली और बराबर है', 'બર્નરની જ્યોત વાદળી અને સરખી છે'),
      photoIfFail(6, 'Photo of the flame', 'लौ की फोटो', 'જ્યોતનો ફોટો'),
    ],
  },
  {
    key: 'ice-machine',
    category: 'KITCHEN_EQUIPMENT',
    name: { en: 'Ice machine sanitising', hi: 'आइस मशीन सैनिटाइज़िंग', gu: 'આઇસ મશીન સેનિટાઇઝિંગ' },
    description: {
      en: 'Monthly clean and sanitise; filter change every 6 months.',
      hi: 'मासिक सफाई और सैनिटाइज़; हर 6 महीने फ़िल्टर बदलें।',
      gu: 'માસિક સફાઈ અને સેનિટાઇઝ; દર 6 મહિને ફિલ્ટર બદલો.',
    },
    steps: [
      tick('Ice bin emptied', 'आइस बिन खाली किया', 'આઇસ બિન ખાલી કર્યો'),
      tick('Cleaning cycle run', 'क्लीनिंग साइकल चलाया', 'ક્લીનિંગ સાયકલ ચલાવી'),
      tick('Sanitising cycle run', 'सैनिटाइज़िंग साइकल चलाया', 'સેનિટાઇઝિંગ સાયકલ ચલાવી'),
      check('No slime or mould left', 'कोई चिपचिपाहट या फफूंद नहीं बची', 'કોઈ ચીકાશ કે ફૂગ બાકી નથી'),
      photoIfFail(4, 'Photo of what is left', 'जो बचा उसकी फोटो', 'જે બાકી છે તેનો ફોટો'),
      check('Water filter changed (if due)', 'पानी का फ़िल्टर बदला (अगर समय हो)', 'પાણીનું ફિલ્ટર બદલ્યું (જો સમય હોય)'),
      tick('First batch of ice thrown away', 'पहली बार की बर्फ फेंक दी', 'પહેલી વારનો બરફ ફેંકી દીધો'),
    ],
  },
  {
    key: 'gas-safety',
    category: 'GAS',
    name: { en: 'Gas line safety check', hi: 'गैस लाइन सुरक्षा जांच', gu: 'ગેસ લાઇન સુરક્ષા તપાસ' },
    description: {
      en: 'Monthly leak test of joints, hoses, detector and shut-off valve.',
      hi: 'जोड़, पाइप, डिटेक्टर और शट-ऑफ वाल्व की मासिक लीक जांच।',
      gu: 'જોડાણ, પાઇપ, ડિટેક્ટર અને શટ-ઑફ વાલ્વની માસિક લીક તપાસ.',
    },
    steps: [
      section('Supply', 'सप्लाई', 'સપ્લાય'),
      check('Cylinder / line valve in good condition', 'सिलेंडर / लाइन वाल्व ठीक हालत में', 'સિલિન્ડર / લાઇન વાલ્વ સારી સ્થિતિમાં'),
      check('Soap-bubble test on all joints: no leak', 'सभी जोड़ों पर साबुन-बुलबुला जांच: कोई लीक नहीं', 'બધા જોડાણ પર સાબુ-પરપોટા તપાસ: કોઈ લીક નથી'),
      photoIfFail(3, 'Photo of the leaking joint', 'लीक वाले जोड़ की फोटो', 'લીક થતા જોડાણનો ફોટો'),
      check('Hoses not cracked or past expiry', 'पाइप फटे या एक्सपायर नहीं', 'પાઇપ ફાટેલી કે એક્સપાયર નથી'),
      section('Safety', 'सुरक्षा', 'સુરક્ષા'),
      check('Gas leak detector works', 'गैस लीक डिटेक्टर काम करता है', 'ગેસ લીક ડિટેક્ટર કામ કરે છે'),
      check('Emergency shut-off valve easy to reach', 'इमरजेंसी शट-ऑफ वाल्व आसानी से पहुंच में', 'ઇમરજન્સી શટ-ઑફ વાલ્વ સરળતાથી પહોંચમાં'),
      { title: { en: 'Technician signature', hi: 'टेक्नीशियन के हस्ताक्षर', gu: 'ટેક્નિશિયનની સહી' }, inputType: 'SIGNATURE' },
    ],
  },
  {
    key: 'fire-extinguishers',
    category: 'FIRE_SAFETY',
    name: { en: 'Fire extinguisher monthly check', hi: 'अग्निशामक मासिक जांच', gu: 'અગ્નિશામક માસિક તપાસ' },
    description: {
      en: 'Pressure, pin and seal, access and the service tag.',
      hi: 'प्रेशर, पिन और सील, पहुंच और सर्विस टैग।',
      gu: 'પ્રેશર, પિન અને સીલ, પહોંચ અને સર્વિસ ટેગ.',
    },
    steps: [
      check('Pressure gauge in the green zone', 'प्रेशर गेज हरे हिस्से में', 'પ્રેશર ગેજ લીલા ભાગમાં'),
      check('Pin and seal intact', 'पिन और सील सही', 'પિન અને સીલ સાબૂત'),
      check('Easy to reach, sign visible', 'आसानी से पहुंच में, साइन दिख रहा है', 'સરળતાથી પહોંચમાં, સાઇન દેખાય છે'),
      check('Kitchen suppression nozzle caps in place', 'किचन सप्रेशन नोज़ल के कैप लगे हैं', 'કિચન સપ્રેશન નોઝલના કેપ લાગેલા છે'),
      { title: { en: 'Last service date (from the tag)', hi: 'पिछली सर्विस की तारीख (टैग से)', gu: 'છેલ્લી સર્વિસની તારીખ (ટેગ પરથી)' }, inputType: 'TEXT' },
      { title: { en: 'Photo of the tag', hi: 'टैग की फोटो', gu: 'ટેગનો ફોટો' }, inputType: 'PHOTO' },
    ],
  },
  {
    key: 'ac-service',
    category: 'AC',
    name: { en: 'AC filter & performance service', hi: 'AC फ़िल्टर और परफॉर्मेंस सर्विस', gu: 'AC ફિલ્ટર અને પર્ફોર્મન્સ સર્વિસ' },
    description: {
      en: 'Monthly in summer: filters, drain, coil and cooling.',
      hi: 'गर्मी में मासिक: फ़िल्टर, ड्रेन, कॉइल और कूलिंग।',
      gu: 'ઉનાળામાં માસિક: ફિલ્ટર, ડ્રેન, કૉઇલ અને કૂલિંગ.',
    },
    steps: [
      tick('Filters washed and dried', 'फ़िल्टर धोकर सुखाए', 'ફિલ્ટર ધોઈને સૂકવ્યા'),
      check('Drain pan and pipe clear', 'ड्रेन पैन और पाइप साफ', 'ડ્રેન પેન અને પાઇપ સાફ'),
      check('Outdoor unit coil clean', 'आउटडोर यूनिट कॉइल साफ', 'આઉટડોર યુનિટ કૉઇલ સાફ'),
      { title: { en: 'Supply air temperature', hi: 'निकलती हवा का तापमान', gu: 'નીકળતી હવાનું તાપમાન' }, inputType: 'NUMBER', unit: '°C', min: 8, max: 18 },
      check('No unusual noise or vibration', 'कोई अजीब आवाज़ या कंपन नहीं', 'કોઈ અસામાન્ય અવાજ કે કંપન નથી'),
      photoIfFail(5, 'Video or photo of the problem', 'समस्या की वीडियो या फोटो', 'સમસ્યાનો વીડિયો કે ફોટો'),
    ],
  },
  {
    key: 'grease-trap',
    category: 'PLUMBING',
    name: { en: 'Grease trap cleaning', hi: 'ग्रीस ट्रैप सफाई', gu: 'ગ્રીસ ટ્રેપ સફાઈ' },
    description: {
      en: 'Remove grease and solids before they block the drain.',
      hi: 'ड्रेन बंद होने से पहले ग्रीस और ठोस कचरा निकालें।',
      gu: 'ડ્રેન બંધ થાય તે પહેલાં ગ્રીસ અને ઘન કચરો કાઢો.',
    },
    steps: [
      { title: { en: 'Before photo', hi: 'पहले की फोटो', gu: 'પહેલાનો ફોટો' }, inputType: 'PHOTO' },
      { title: { en: 'Grease layer depth', hi: 'ग्रीस की परत की गहराई', gu: 'ગ્રીસના થરની ઊંડાઈ' }, inputType: 'NUMBER', unit: 'cm', min: 0 },
      tick('Grease and solids removed', 'ग्रीस और ठोस कचरा निकाला', 'ગ્રીસ અને ઘન કચરો કાઢ્યો'),
      check('Waste given to a licensed collector', 'कचरा लाइसेंस वाले कलेक्टर को दिया', 'કચરો લાયસન્સવાળા કલેક્ટરને આપ્યો'),
      check('Lid sealed, no smell', 'ढक्कन बंद, कोई बदबू नहीं', 'ઢાંકણ બંધ, કોઈ દુર્ગંધ નથી'),
      { title: { en: 'After photo', hi: 'बाद की फोटो', gu: 'પછીનો ફોટો' }, inputType: 'PHOTO' },
    ],
  },
  {
    key: 'opening-check',
    category: 'OTHER',
    name: { en: 'Daily opening check', hi: 'रोज़ खोलने से पहले की जांच', gu: 'રોજ ખોલતા પહેલાની તપાસ' },
    description: {
      en: 'Five-minute walk-round before guests arrive.',
      hi: 'मेहमानों के आने से पहले पांच मिनट का चक्कर।',
      gu: 'મહેમાનો આવે તે પહેલાં પાંચ મિનિટનો રાઉન્ડ.',
    },
    steps: [
      section('Kitchen', 'किचन', 'કિચન'),
      check('Fridges between 0 and 5 °C', 'फ्रिज 0 से 5 °C के बीच', 'ફ્રિજ 0 થી 5 °C વચ્ચે'),
      check('Gas burners light properly', 'गैस बर्नर ठीक से जलते हैं', 'ગેસ બર્નર બરાબર સળગે છે'),
      check('Exhaust fan running', 'एग्ज़ॉस्ट फैन चल रहा है', 'એક્ઝોસ્ટ ફેન ચાલુ છે'),
      section('Dining & washrooms', 'डाइनिंग और वॉशरूम', 'ડાઇનિંગ અને વૉશરૂમ'),
      check('AC and lights working', 'AC और लाइटें चल रही हैं', 'AC અને લાઇટ ચાલુ છે'),
      check('Washrooms: water and flush working', 'वॉशरूम: पानी और फ्लश चल रहा है', 'વૉશરૂમ: પાણી અને ફ્લશ ચાલુ છે'),
      notes,
    ],
  },
  {
    key: 'pest-control',
    category: 'PEST_CONTROL',
    name: { en: 'Pest control inspection', hi: 'कीट नियंत्रण जांच', gu: 'જીવાત નિયંત્રણ તપાસ' },
    description: {
      en: 'Fortnightly look for signs of pests and entry points.',
      hi: 'हर पखवाड़े कीड़ों के निशान और घुसने की जगह देखें।',
      gu: 'દર પખવાડિયે જીવાતના નિશાન અને પ્રવેશની જગ્યા જુઓ.',
    },
    steps: [
      check('No signs of rodents (droppings, gnaw marks)', 'चूहों के निशान नहीं (मल, कुतरने के निशान)', 'ઉંદરના નિશાન નથી (મળ, કોતરવાના નિશાન)'),
      photoIfFail(1, 'Photo of the signs', 'निशानों की फोटो', 'નિશાનોનો ફોટો'),
      check('Fly catchers working', 'फ्लाई कैचर चल रहे हैं', 'ફ્લાય કેચર ચાલુ છે'),
      check('Drains covered', 'ड्रेन ढके हुए', 'ડ્રેન ઢાંકેલા'),
      check('Gaps under doors sealed', 'दरवाज़ों के नीचे की दरारें बंद', 'દરવાજા નીચેની તિરાડો બંધ'),
      { title: { en: 'Last pest service date', hi: 'पिछली पेस्ट सर्विस की तारीख', gu: 'છેલ્લી પેસ્ટ સર્વિસની તારીખ' }, inputType: 'TEXT', required: false },
    ],
  },
]

/** The library entry as a procedure input in one language. */
export function libraryProcedureInput(entry: LibraryProcedure, locale: Locale) {
  return {
    name: entry.name[locale],
    description: entry.description[locale],
    category: entry.category,
    steps: entry.steps.map((s) => ({
      title: s.title[locale],
      instruction: '',
      inputType: s.inputType,
      unit: s.unit ?? '',
      minValue: s.min,
      maxValue: s.max,
      required: s.required ?? s.inputType !== 'SECTION',
      options: [] as string[],
      requirePhoto: s.requirePhoto ?? false,
      showIf: s.showIf ?? null,
    })),
  }
}
