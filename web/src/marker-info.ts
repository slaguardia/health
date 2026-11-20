// General background on each lab marker: what it measures, what's known to drive it
// (including how much is inherited), and which markers it's read with. Every note
// cites its sources. These describe the test, never a verdict on anyone's result.

export type Source = { title: string; url: string };
export type MarkerInfo = {
  what: string;
  genes?: string;               // how much is inherited vs changeable, when the evidence says
  inherited?: "mostly" | "partly";
  context?: string;             // why it's read alongside other markers, or published cutoffs
  readWith?: string[];          // marker ids
  sources: Source[];
};

const mp = (slug: string, title: string): Source => ({ title: `MedlinePlus: ${title}`, url: `https://medlineplus.gov/lab-tests/${slug}/` });
const gene = (slug: string, title: string): Source => ({ title: `MedlinePlus Genetics: ${title}`, url: `https://medlineplus.gov/genetics/condition/${slug}/` });
const doi = (title: string, d: string): Source => ({ title, url: `https://doi.org/${d}` });

const S = {
  eas: doi("Kronenberg et al., Lipoprotein(a) in atherosclerotic cardiovascular disease and aortic stenosis: a European Atherosclerosis Society consensus statement. Eur Heart J 2022", "10.1093/eurheartj/ehac361"),
  nla: doi("Koschinsky et al., A focused update to the 2019 NLA scientific statement on use of lipoprotein(a) in clinical practice. J Clin Lipidol 2024", "10.1016/j.jacl.2024.03.001"),
  acc: doi("Grundy et al., 2018 AHA/ACC Guideline on the Management of Blood Cholesterol. Circulation 2019", "10.1161/CIR.0000000000000625"),
  apob: doi("Sniderman et al., Apolipoprotein B Particles and Cardiovascular Disease: A Narrative Review. JAMA Cardiol 2019", "10.1001/jamacardio.2019.3780"),
  disc: doi("Otvos et al., Clinical implications of discordance between LDL cholesterol and particle number. J Clin Lipidol 2011", "10.1016/j.jacl.2011.02.001"),
  ldlSize: doi("Berneis & Krauss, Metabolic origins and clinical significance of LDL heterogeneity. J Lipid Res 2002", "10.1194/jlr.R200004-JLR200"),
  hdlGenes: doi("Weissglas-Volkov & Pajukanta, Genetic causes of high and low serum HDL-cholesterol. J Lipid Res 2010", "10.1194/jlr.r004739"),
  pla2: doi("Lp-PLA2 Studies Collaboration, Lp-PLA2 and risk of coronary disease, stroke, and mortality: 32 prospective studies. Lancet 2010", "10.1016/S0140-6736(10)60319-4"),
  crp: doi("Pearson et al., Markers of Inflammation and Cardiovascular Disease (AHA/CDC statement). Circulation 2003", "10.1161/01.CIR.0000052939.59093.45"),
  eos: doi("Valent et al., Contemporary consensus proposal on criteria and classification of eosinophilic disorders. J Allergy Clin Immunol 2012", "10.1016/j.jaci.2012.02.019"),
  o3: doi("Harris & von Schacky, The Omega-3 Index: a new risk factor for death from coronary heart disease? Prev Med 2004", "10.1016/j.ypmed.2004.02.030"),
  o3Ods: { title: "NIH Office of Dietary Supplements: Omega-3 Fatty Acids fact sheet", url: "https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/" },
  zincOds: { title: "NIH Office of Dietary Supplements: Zinc fact sheet", url: "https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/" },
  kdigo: doi("KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease. Kidney Int 2024", "10.1016/j.kint.2023.10.018"),
  creatine: doi("Longobardi et al., Is It Time for a Requiem for Creatine Supplementation-Induced Kidney Failure? A Narrative Review. Nutrients 2023", "10.3390/nu15061466"),
  cysC: doi("Dharnidharka et al., Serum cystatin C is superior to serum creatinine as a marker of kidney function: a meta-analysis. Am J Kidney Dis 2002", "10.1053/ajkd.2002.34487"),
  testo: doi("Bhasin et al., Testosterone Therapy in Men With Hypogonadism: An Endocrine Society Clinical Practice Guideline. J Clin Endocrinol Metab 2018", "10.1210/jc.2018-00229"),
  ada: doi("American Diabetes Association, Diagnosis and Classification of Diabetes: Standards of Care in Diabetes 2025. Diabetes Care", "10.2337/dc25-S002"),
  whoFerritin: { title: "WHO guideline on use of ferritin concentrations to assess iron status (2020)", url: "https://www.who.int/publications/i/item/9789240000124" },
  strongy: { title: "CDC: About Strongyloides", url: "https://www.cdc.gov/strongyloides/" },
  toxo: { title: "CDC: About Toxocariasis", url: "https://www.cdc.gov/toxocariasis/" },
  cbc: mp("complete-blood-count-cbc", "Complete Blood Count"),
  diff: mp("blood-differential", "Blood Differential"),
  indices: mp("red-blood-cell-rbc-indices", "RBC Indices"),
  thal: gene("beta-thalassemia", "Beta thalassemia"),
  fh: gene("familial-hypercholesterolemia", "Familial hypercholesterolemia"),
  hemo: gene("hereditary-hemochromatosis", "Hereditary hemochromatosis"),
  gilbert: gene("gilbert-syndrome", "Gilbert syndrome"),
  chol: mp("cholesterol-levels", "Cholesterol Levels"),
  iron: mp("iron-tests", "Iron Tests"),
  lytes: mp("electrolyte-panel", "Electrolyte Panel"),
  testoMp: mp("testosterone-levels-test", "Testosterone Levels Test"),
  thyroidAb: mp("thyroid-antibody-tests", "Thyroid Antibody Tests"),
  protein: mp("total-protein-and-albumin-globulin-a-g-ratio", "Total Protein and A/G Ratio"),
  vitB: mp("vitamin-b-test", "Vitamin B Test"),
};

const pct = (abs: string, cell: string): MarkerInfo => ({
  what: `The share of white cells that are ${cell}. The absolute count is the one to follow, since a percentage shifts whenever another cell type rises or falls.`,
  readWith: [abs], sources: [S.diff],
});
const fattyAcid = (name: string): MarkerInfo => ({
  what: `${name}, one of the long-chain omega-3 fatty acids, mostly from fatty fish and fish oil. Part of the omega-3 index.`,
  readWith: ["omega-3-index"], sources: [S.o3Ods, S.o3],
});

export const MARKER_INFO: Record<string, MarkerInfo> = {
  // --- blood count ---
  wbc: { what: "All white blood cells, the immune system's cells. Infection, inflammation, stress and some medicines raise it; the breakdown by cell type says more than the total.", readWith: ["neutrophils-abs", "lymphocytes-abs", "eosinophils-abs"], sources: [mp("white-blood-count-wbc", "White Blood Count"), S.diff] },
  rbc: { what: "Red blood cells, which carry oxygen. Read with hemoglobin, hematocrit and the red cell indices.", readWith: ["hemoglobin", "hematocrit", "mcv"], sources: [mp("red-blood-cell-rbc-count", "Red Blood Cell Count")] },
  hemoglobin: { what: "The oxygen-carrying protein in red cells. Low means anemia; smoking, lung disease and living at high altitude can raise it.", readWith: ["hematocrit", "rbc", "ferritin"], sources: [mp("hemoglobin-test", "Hemoglobin Test")] },
  hematocrit: { what: "The share of blood volume made up of red cells. It moves with hemoglobin, and dehydration can push both up.", readWith: ["hemoglobin", "rbc"], sources: [mp("hematocrit-test", "Hematocrit Test")] },
  mcv: { what: "Average red cell size. Small cells are typical of iron deficiency or thalassemia; large cells of a B vitamin deficiency (B12 or folate) or liver disease.", genes: "Thalassemia is an inherited blood disorder, fairly common worldwide; its mild form causes mild anemia.", readWith: ["ferritin", "vitamin-b12", "folate-serum", "rdw"], sources: [S.indices, S.vitB, S.thal] },
  mch: { what: "Average amount of hemoglobin in each red cell. It usually moves with MCV.", readWith: ["mcv", "mchc"], sources: [S.indices] },
  mchc: { what: "How concentrated hemoglobin is inside red cells.", readWith: ["mcv", "mch"], sources: [S.indices] },
  rdw: { what: "How much red cells vary in size. Read with MCV, it helps sort out iron deficiency and other types of anemia.", readWith: ["mcv", "ferritin"], sources: [mp("rdw-red-cell-distribution-width", "RDW")] },
  platelets: { what: "Cell fragments that help blood clot.", readWith: ["mpv"], sources: [mp("platelet-tests", "Platelet Tests")] },
  mpv: { what: "Average platelet size, mostly useful next to the platelet count.", readWith: ["platelets"], sources: [mp("mpv-blood-test", "MPV Blood Test")] },
  "neutrophils-abs": { what: "The most common white cell, the first responders to bacterial infection.", sources: [S.diff] },
  "lymphocytes-abs": { what: "White cells that fight viruses and make antibodies.", sources: [S.diff] },
  "monocytes-abs": { what: "White cells that fight infection and clear away damaged cells.", sources: [S.diff] },
  "eosinophils-abs": {
    what: "White cells involved in allergies, asthma and fighting parasites. Allergic conditions, parasite infections and some medicines are the usual causes of a high count.",
    context: "Consensus criteria call an absolute count above 1,500 cells/µL hypereosinophilia, particularly when it's found on two tests at least a month apart. IgE and parasite antibody tests help narrow the cause.",
    readWith: ["ige", "toxocara-igg", "strongyloides-igg", "eosinophils-pct"], sources: [S.diff, S.eos],
  },
  "basophils-abs": { what: "The rarest white cell, involved in allergic reactions.", sources: [S.diff] },
  "neutrophils-pct": pct("neutrophils-abs", "neutrophils"),
  "lymphocytes-pct": pct("lymphocytes-abs", "lymphocytes"),
  "monocytes-pct": pct("monocytes-abs", "monocytes"),
  "eosinophils-pct": pct("eosinophils-abs", "eosinophils"),
  "basophils-pct": pct("basophils-abs", "basophils"),

  // --- blood sugar ---
  glucose: { what: "Blood sugar at the moment of the draw; the ranges assume fasting.", context: "Diabetes guidelines call a fasting glucose of 100–125 mg/dL prediabetes and 126 or more diabetes.", readWith: ["hba1c", "insulin"], sources: [mp("blood-glucose-test", "Blood Glucose Test"), S.ada] },
  hba1c: { what: "Average blood sugar over roughly the past 2–3 months.", context: "Under 5.7% is normal, 5.7–6.4% prediabetes and 6.5% or more diabetes. Anemia and other conditions that affect red cells can make it inaccurate.", readWith: ["glucose", "insulin"], sources: [mp("hemoglobin-a1c-hba1c-test", "Hemoglobin A1C Test"), S.ada] },
  insulin: { what: "Insulin level, usually fasting. A high fasting insulin with normal glucose can be an early sign of insulin resistance.", context: "Insulin resistance tends to come with high triglycerides, low HDL and small dense LDL, so those are read together.", readWith: ["glucose", "hba1c", "triglycerides", "hdl-cholesterol", "ldl-small"], sources: [mp("insulin-in-blood-test", "Insulin in Blood"), S.ldlSize] },

  // --- electrolytes ---
  sodium: { what: "The main salt in blood. Mostly reflects water balance, kidney function and medicines.", sources: [mp("sodium-blood-test", "Sodium Blood Test"), S.lytes] },
  potassium: { what: "An electrolyte that nerves, muscles and the heart rely on. Kidney function and medicines move it, and clenching your fist during the draw can raise it for a moment.", sources: [mp("potassium-blood-test", "Potassium Blood Test"), S.lytes] },
  chloride: { what: "An electrolyte that moves with sodium and helps keep the blood's acid-base balance.", sources: [mp("chloride-blood-test", "Chloride Blood Test"), S.lytes] },
  "carbon-dioxide": { what: "Bicarbonate, the blood's main buffer; it reflects acid-base balance.", sources: [mp("carbon-dioxide-co2-in-blood", "Carbon Dioxide in Blood"), S.lytes] },
  calcium: { what: "Calcium in blood, kept in a tight band by parathyroid hormone and vitamin D. About half is bound to blood proteins, so it's read with albumin.", readWith: ["albumin", "vitamin-d-25-oh"], sources: [mp("calcium-blood-test", "Calcium Blood Test")] },

  // --- fatty acids ---
  "omega-3-index": {
    what: "The share of fatty acids in blood that are long-chain omega-3s (EPA, DHA, and on some tests DPA). It reflects longer-term intake, mostly from fatty fish and fish oil.",
    context: "Labs measure it differently (red cells or whole blood, with or without DPA), so numbers and cutoffs only compare within the same test. In the original research version, EPA+DHA in red cells, 8% or more went with the lowest risk of death from heart disease.",
    readWith: ["epa", "dha", "aa-epa-ratio"], sources: [S.o3, S.o3Ods],
  },
  "omega-3-total": { what: "The sum of the omega-3 fatty acids the test measures.", readWith: ["omega-3-index"], sources: [S.o3Ods] },
  epa: fattyAcid("EPA"),
  dpa: fattyAcid("DPA"),
  dha: fattyAcid("DHA"),
  "omega-6-total": { what: "The sum of the omega-6 fatty acids measured, mainly linoleic acid (from vegetable oils, nuts and seeds) and arachidonic acid.", readWith: ["omega6-omega3-ratio"], sources: [S.o3Ods] },
  "arachidonic-acid": { what: "An omega-6 fatty acid the body makes from linoleic acid; it competes with EPA and DHA in making inflammatory signals.", readWith: ["aa-epa-ratio"], sources: [S.o3Ods] },
  "linoleic-acid": { what: "The main dietary omega-6, an essential fatty acid from vegetable oils, nuts and seeds.", sources: [S.o3Ods] },
  "omega6-omega3-ratio": { what: "Omega-6 relative to omega-3; it falls as omega-3 intake rises.", context: "An ideal ratio hasn't been defined, and some experts consider ratios too nonspecific, so the omega-3 index is usually the number to follow.", readWith: ["omega-3-index"], sources: [S.o3Ods] },
  "aa-epa-ratio": { what: "Arachidonic acid (omega-6) relative to EPA (omega-3); it falls as EPA intake rises.", readWith: ["epa", "omega-3-index"], sources: [S.o3Ods] },

  // --- hormones ---
  "testosterone-total": { what: "Total testosterone, best drawn in the morning when it peaks.", context: "The Endocrine Society diagnoses low testosterone only with consistent symptoms plus repeatedly low morning, fasting levels; when SHBG is unusual, free testosterone is measured too.", readWith: ["testosterone-free", "shbg"], sources: [S.testoMp, S.testo] },
  "testosterone-free": { what: "The small share of testosterone not bound to proteins.", context: "Guidelines suggest measuring it when SHBG is high or low enough to make the total misleading.", readWith: ["testosterone-total", "shbg"], sources: [S.testo] },
  "testosterone-bioavailable": { what: "Free testosterone plus the part loosely bound to albumin, the share tissues can readily use.", readWith: ["testosterone-total", "shbg"], sources: [S.testoMp, S.testo] },
  shbg: { what: "The protein that carries testosterone and estradiol in blood. It sets how much testosterone is free, so it's read with total and free testosterone.", readWith: ["testosterone-total", "testosterone-free"], sources: [mp("shbg-blood-test", "SHBG Blood Test"), S.testo] },
  estradiol: { what: "The main estrogen. It matters in men too, for bone, cholesterol and blood sugar.", sources: [mp("estrogen-levels-test", "Estrogen Levels Test")] },
  "dhea-sulfate": { what: "An adrenal hormone the body uses to make sex hormones; levels decline with age.", sources: [mp("dhea-sulfate-test", "DHEA Sulfate Test")] },
  "cortisol-am": { what: "The main stress hormone. It peaks in the morning and falls through the day, so its range depends on the time of the draw.", sources: [mp("cortisol-test", "Cortisol Test")] },

  // --- immune and infections ---
  ige: { what: "Total IgE, the antibody class behind allergic reactions.", readWith: ["eosinophils-abs"], sources: [mp("allergy-blood-test", "Allergy Blood Test")] },
  "toxocara-igg": { what: "Antibodies to Toxocara, a roundworm spread through dog and cat feces in soil. One of the parasite causes looked for when eosinophils are high.", readWith: ["eosinophils-abs"], sources: [S.toxo, S.eos] },
  "strongyloides-igg": { what: "Antibodies to Strongyloides, a soil roundworm that can live in the body for years. One of the parasite causes looked for when eosinophils are high.", readWith: ["eosinophils-abs"], sources: [S.strongy, S.eos] },
  rpr: { what: "A screening test for syphilis; a reactive result is confirmed with a second, different test.", sources: [mp("syphilis-tests", "Syphilis Tests")] },

  // --- inflammation ---
  "hs-crp": { what: "A sensitive measure of low-level inflammation. A recent infection or injury can raise it for a while.", context: "For heart risk, the AHA/CDC call under 1 mg/L low, 1–3 average and over 3 high; the cholesterol guideline counts 2 or more as a risk enhancer.", readWith: ["lp-pla2", "ferritin"], sources: [mp("c-reactive-protein-crp-test", "C-Reactive Protein Test"), S.crp, S.acc] },
  "lp-pla2": { what: "An inflammatory enzyme found in artery plaque that rises with the cholesterol particles that build plaque.", context: "Across 32 studies it tracked with heart risk about as strongly as non-HDL cholesterol, and that link depends partly on cholesterol levels, so it's read with ApoB and LDL particle number.", readWith: ["apob", "ldl-particle-number", "hs-crp"], sources: [S.pla2] },

  // --- iron ---
  ferritin: {
    what: "The body's iron stores. It's also an inflammation marker, so infection or inflammation can push it up and hide low stores; that's why it's read with CRP.",
    genes: "High ferritin can point to hereditary hemochromatosis, an inherited condition in which the body absorbs too much iron.",
    readWith: ["iron-saturation", "iron-total", "hemoglobin", "hs-crp"], sources: [mp("ferritin-blood-test", "Ferritin Blood Test"), S.whoFerritin, S.hemo],
  },
  "iron-total": { what: "Iron in blood right now. It varies through the day and is often higher in the morning, so stores (ferritin) say more.", readWith: ["ferritin", "iron-saturation"], sources: [S.iron] },
  tibc: { what: "How well iron binds to transferrin and other blood proteins; read with iron and ferritin.", readWith: ["iron-saturation", "ferritin"], sources: [S.iron] },
  "iron-saturation": { what: "How full transferrin, the iron carrier, is with iron (iron divided by TIBC). Low and high both matter, so it's read with ferritin.", readWith: ["ferritin", "tibc"], sources: [S.iron] },

  // --- kidney ---
  creatinine: {
    what: "A waste product of muscle, used to estimate kidney function. Dehydration, intense exercise, a meat-heavy diet, more muscle and creatine supplements can raise it without kidney disease.",
    context: "So a single high value is read with eGFR and BUN, and if needed with cystatin C, which doesn't depend on muscle; KDIGO suggests a cystatin C-based estimate when creatinine may mislead.",
    readWith: ["egfr", "bun", "bun-creatinine-ratio"], sources: [mp("creatinine-test", "Creatinine Test"), S.creatine, S.kdigo],
  },
  egfr: { what: "Estimated kidney filtering rate, calculated from creatinine. Because it rests on creatinine, it can read low in muscular people or those taking creatine.", context: "Guidelines suggest a cystatin C-based estimate when the creatinine-based one is in doubt.", readWith: ["creatinine"], sources: [mp("estimated-glomerular-filtration-rate-egfr-and-gfr-tests", "eGFR and GFR Tests"), S.creatine, S.kdigo, S.cysC] },
  bun: { what: "Urea, a waste product of protein breakdown cleared by the kidneys. Protein intake and hydration move it.", readWith: ["creatinine", "bun-creatinine-ratio"], sources: [mp("bun-blood-urea-nitrogen", "BUN Test")] },
  "bun-creatinine-ratio": { what: "BUN divided by creatinine; it helps tell dehydration and other non-kidney causes from kidney ones.", readWith: ["bun", "creatinine"], sources: [mp("bun-blood-urea-nitrogen", "BUN Test")] },

  // --- lipids ---
  "cholesterol-total": { what: "All cholesterol in blood, from every kind of particle. The parts (LDL, HDL, non-HDL, ApoB) say more than the total.", readWith: ["ldl-cholesterol", "hdl-cholesterol", "apob"], sources: [S.chol] },
  "hdl-cholesterol": {
    what: "Cholesterol in HDL particles, which carry cholesterol away from the arteries. Low HDL goes with higher heart risk.",
    genes: "40–60% heritable. Inactivity, smoking, high triglycerides and insulin resistance also lower it.",
    inherited: "partly", readWith: ["triglycerides", "hdl-large", "ldl-pattern", "insulin"], sources: [S.hdlGenes, S.chol, S.ldlSize],
  },
  "ldl-cholesterol": {
    what: "Cholesterol carried in LDL particles, the main driver of artery plaque.",
    context: "Small LDL particles each carry less cholesterol, so LDL cholesterol can look normal while the particle count (ApoB, LDL particle number) is high. When they disagree, risk tracks the particle count.",
    genes: "Very high LDL can be familial hypercholesterolemia, an inherited condition.",
    readWith: ["apob", "ldl-particle-number", "non-hdl-cholesterol"], sources: [S.chol, S.disc, S.fh],
  },
  triglycerides: { what: "Fat carried in blood. Recent meals, sugar and refined carbs, alcohol, excess weight and poorly controlled diabetes raise it.", context: "High triglycerides travel with low HDL and small dense LDL.", readWith: ["hdl-cholesterol", "ldl-small", "insulin"], sources: [mp("triglycerides-test", "Triglycerides Test"), S.ldlSize] },
  "non-hdl-cholesterol": { what: "Total cholesterol minus HDL: the cholesterol in every particle that can build plaque. A practical stand-in for ApoB.", readWith: ["apob", "ldl-cholesterol"], sources: [S.acc, S.apob] },
  "chol-hdl-ratio": { what: "Total cholesterol divided by HDL.", readWith: ["cholesterol-total", "hdl-cholesterol"], sources: [S.chol] },
  apob: {
    what: "A count of plaque-forming particles: every LDL, VLDL and Lp(a) particle carries exactly one ApoB. When ApoB and LDL cholesterol disagree, risk tracks ApoB.",
    context: "The cholesterol guideline lists an ApoB of 130 mg/dL or more as a risk enhancer.",
    readWith: ["ldl-particle-number", "ldl-cholesterol", "non-hdl-cholesterol", "lipoprotein-a"], sources: [S.apob, S.acc],
  },
  "lipoprotein-a": {
    what: "An LDL-like particle with an extra protein attached. It adds to the risk of heart disease and aortic valve narrowing on top of LDL.",
    genes: "Over 90% set by genes and stable through life, so one test is usually enough; lifestyle changes have minimal effect on it.",
    inherited: "mostly",
    context: "The National Lipid Association calls under 75 nmol/L low risk, 75–125 intermediate and 125 or more high. It recommends testing first-degree relatives of people with high levels, and earlier, more intensive control of the other risk factors.",
    readWith: ["apob", "ldl-cholesterol", "ldl-particle-number"], sources: [S.eas, S.nla, S.acc, mp("lipoprotein-a-blood-test", "Lipoprotein (a) Blood Test")],
  },
  "ldl-particle-number": { what: "The number of LDL particles, measured by NMR. Like ApoB, it can be high while LDL cholesterol looks normal.", context: "In a large cohort, when LDL particle number and LDL cholesterol disagreed, heart risk tracked the particle number.", readWith: ["apob", "ldl-cholesterol", "ldl-small"], sources: [S.disc, S.apob] },
  "ldl-small": { what: "The concentration of small LDL particles.", context: "Mostly small, dense LDL is part of a pattern with high triglycerides, low HDL and insulin resistance that adds heart risk.", readWith: ["ldl-pattern", "ldl-peak-size", "triglycerides", "hdl-cholesterol", "insulin"], sources: [S.ldlSize] },
  "ldl-medium": { what: "The concentration of medium-sized LDL particles.", readWith: ["ldl-small", "ldl-particle-number"], sources: [S.ldlSize] },
  "hdl-large": { what: "The concentration of large HDL particles. Fewer of them usually comes with low HDL cholesterol and the small-LDL pattern.", readWith: ["hdl-cholesterol", "ldl-pattern"], sources: [S.ldlSize] },
  "ldl-pattern": { what: "Pattern A means mostly large LDL particles; pattern B, mostly small dense ones.", context: "Pattern B comes with raised triglyceride-rich remnants, low HDL and insulin resistance, a combination linked to more heart risk.", readWith: ["ldl-small", "ldl-peak-size", "triglycerides", "hdl-cholesterol"], sources: [S.ldlSize] },
  "ldl-peak-size": { what: "The most common LDL particle size; smaller sizes put you in pattern B.", readWith: ["ldl-pattern", "ldl-small"], sources: [S.ldlSize] },

  // --- liver and protein ---
  alt: { what: "A liver enzyme that rises when liver cells are injured, for example by hepatitis, heavy alcohol use or some medicines.", readWith: ["ast", "alkaline-phosphatase", "bilirubin-total"], sources: [mp("alt-blood-test", "ALT Blood Test"), mp("liver-function-tests", "Liver Function Tests")] },
  ast: { what: "An enzyme found in the liver and in muscle, so muscle strain can raise it as well as liver injury.", readWith: ["alt"], sources: [mp("ast-test", "AST Test")] },
  "alkaline-phosphatase": { what: "An enzyme from the liver's bile ducts and from bone.", readWith: ["alt", "bilirubin-total"], sources: [mp("alkaline-phosphatase", "Alkaline Phosphatase")] },
  "bilirubin-total": { what: "A yellow breakdown product of old red cells, cleared by the liver.", genes: "A raised bilirubin found on routine tests can be Gilbert syndrome, a common, relatively mild inherited condition (an estimated 3–7% of Americans).", readWith: ["alt", "ast"], sources: [mp("bilirubin-blood-test", "Bilirubin Blood Test"), S.gilbert] },
  "total-protein": { what: "All protein in blood, mainly albumin and globulins.", readWith: ["albumin", "globulin"], sources: [S.protein] },
  albumin: { what: "The main blood protein, made by the liver. Liver or kidney disease, infection, poor nutrition and some digestive diseases can lower it.", readWith: ["total-protein", "calcium"], sources: [mp("albumin-blood-test", "Albumin Blood Test")] },
  globulin: { what: "Blood proteins other than albumin: some made by the liver, others by the immune system.", readWith: ["total-protein", "albumin-globulin-ratio"], sources: [mp("globulin-test", "Globulin Test"), S.protein] },
  "albumin-globulin-ratio": { what: "Albumin divided by globulin.", readWith: ["albumin", "globulin"], sources: [S.protein] },

  // --- thyroid ---
  tsh: { what: "The pituitary's signal to the thyroid, and the usual first screening test. High suggests an underactive thyroid; low, an overactive one.", readWith: ["free-t4", "free-t3", "tpo-antibodies"], sources: [mp("tsh-thyroid-stimulating-hormone-test", "TSH Test")] },
  "free-t4": { what: "The main thyroid hormone, in its unbound form. Read with TSH.", readWith: ["tsh", "free-t3"], sources: [mp("thyroxine-t4-test", "Thyroxine (T4) Test")] },
  "free-t3": { what: "The active thyroid hormone, in its unbound form.", readWith: ["tsh", "free-t4"], sources: [mp("triiodothyronine-t3-tests", "T3 Tests")] },
  "tpo-antibodies": { what: "Antibodies against a thyroid enzyme. A positive result points to autoimmune thyroid disease such as Hashimoto's.", readWith: ["tsh", "thyroglobulin-antibodies"], sources: [S.thyroidAb] },
  "thyroglobulin-antibodies": { what: "Antibodies against thyroglobulin, a thyroid protein; another marker of autoimmune thyroid disease.", readWith: ["tsh", "tpo-antibodies"], sources: [S.thyroidAb] },

  // --- vitamins and minerals ---
  "vitamin-d-25-oh": { what: "25-hydroxy vitamin D, the storage form and the standard measure of vitamin D status. It reflects sun, diet and supplements.", readWith: ["calcium"], sources: [mp("vitamin-d-test", "Vitamin D Test")] },
  "vitamin-b12": { what: "A vitamin needed for red cells and nerves. Low levels cause large red cells (high MCV).", readWith: ["mcv", "folate-serum"], sources: [S.vitB] },
  "folate-serum": { what: "Folate (vitamin B9), needed to make red cells. Low levels also cause large red cells.", readWith: ["mcv", "vitamin-b12"], sources: [S.vitB] },
  "magnesium-rbc": { what: "Magnesium measured inside red cells rather than in serum.", sources: [mp("magnesium-blood-test", "Magnesium Blood Test")] },
  zinc: { what: "A mineral for immunity and healing. Blood levels vary with time of day and don't always track intake.", sources: [S.zincOds] },
};
