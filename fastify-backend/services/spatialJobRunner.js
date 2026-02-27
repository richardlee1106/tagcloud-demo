/**
 * 缂傚倸鍊搁崐椋庣矆娓氣偓瀵敻顢楅埀顒勨€旈崘顔藉癄濠㈠厜鏅滈惄顖炵嵁閹邦厽鍎熼柨婵嗗缁侇偊姊洪懡銈呅㈡繛璇х畳閵囨劙宕橀鍡欑◤闂侀潧鐗嗛ˇ顖滅棯瑜旈弻宥夊传閸曨偀鍋撻崨濠冨弿閻忕偘鍕樻禍婊堟煏韫囧ň鍋撳畷鍥︽偅缂傚倷娴囨ご鎼佸箲閸パ屽殨濞寸姴顑呮儫闂侀潧锛忛崨顔兼珰闂傚倸鍊风欢姘焽閼姐倗绀婇柛鈩冪⊕閸嬪倸顭跨捄鐑樻拱妞ゎ偅娲橀幈銊ヮ渻缂佹ɑ顔刡 Runner闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟娆¤娲、姗€濮€閻橀潧濮?
 * 缂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柛顐ｆ礀缁愭鈧箍鍎卞ú銊╁础濮樿埖鍊甸柣銏㈡暩閵嗗﹪鏌涚€ｎ偅宕岀€规洜鍏橀、姗€鎮欓悧鍫濈厱濠德板€楁慨鐑藉磻濞戞◤娲敇閻愬灚娈惧┑顔筋焾濞夋盯鐛姀鈥茬箚妞ゆ牗绮犻崕鐘绘煕鐎ｎ亷韬慨濠冩そ濡啫鈽夊▎妯活棤婵犵數鍋炲娆徝洪銏犵畾闁告劦鍠楅崑鍕煕韫囨洖甯跺ù?gRPC 闂傚倷娴囧畷鍨叏瀹曞洦顐介柕鍫濇处椤洟鏌￠崶銉ョ仾闁稿鏅涢埞鎴︽偐鐎圭姴顥濋弶鈺傜箖缁绘稒娼忛崜褍鍩岄梺纭咁嚋缁辨洜鍒掗崼銉ョ劦妞ゆ帒瀚埛鎺戙€掑顒佹悙濞存粍鍔欓弻娑氣偓锝庡亝鐏忕數绱掓潏銊ョ瑨闁宠棄顦埢搴ㄥ箣濠靛啯瀚涢梻鍌欑閹碱偄螞濞嗘挸绀夐柡宥庡亞閻瑥顭跨捄渚剱闁稿海鍠栭弻宥夊Ψ閵婏妇褰у┑鐐叉噷閸ㄨ櫣鎹㈠☉娆愮秶闁告挆鍚锋垹绱撴笟鍥ф灈婵炲鍏樺畷姘跺箳濡も偓鎯熼梺瀹犳〃缁€渚€宕甸幋婵冩斀闁绘顕滃銉╂煙閸愯尙绠荤€殿喗鐓￠獮鏍ㄦ媴閸︻厼骞嶉梺璇插缁嬫帡鏁嬫繝娈垮枛閸婂潡寮?
 */
import { randomUUID } from 'crypto'

import { parseIntent, quickIntentClassify } from '../routes/ai/planner.js'
import { generateAnswer, buildQuickReply } from '../routes/ai/writer.js'
import { computeSpatialStream, isGrpcComputeEnabled } from './grpcClient.js'
import { resolveSpatialMigrationDecision } from './migrationPolicy.js'
import { resolveSourcePolicy } from './sourcePolicy.js'
import * as queryCache from './queryCache.js'
import telemetry from './telemetry.js'
import { insertOperatorTimingEvents } from './database.js'
import { callLLM } from './llm.js'
import { buildFailureDiagnostics } from './errorDiagnostics.js'
import {
  classifyGeoRelevance,
  IRRELEVANT_FRIENDLY_REPLY
} from './relevanceGate.js'

// MVP 闂傚倸鍊烽悞锕傚箖閸洖纾块梺顒€绉寸粻瑙勩亜閹板爼妾柛瀣ф櫅铻栭柨婵嗘噹閺嗘瑧绱掗埀顒勫幢濞戞瑧鍘遍梺鏂ユ櫅閸犳岸鎮炴禒瀣厪闁割偒鍓涢悾鍨叏婵犲偆鐓肩€规洘锕㈡俊姝岊槻妞わ絾妞藉娲焻閻愯尪瀚板褌鍗抽弻鏇㈠幢濡ゅ﹤鍓冲┑鈥冲级閸旀洟鍩為幋鐘亾閿濆簼娴风悮婵嬫⒑绾懎顥嶉柟娲讳簽瀵板﹪宕稿Δ鈧弸浣肝旈敐鍛殲闁绘挻娲樼换娑㈠幢濡浚浜幃姗€鏁撻悩宕囧幗濠德板€撻悞锔句焊閿旂瓔娈介柣鎰綑閻忓瓨銇勯姀锛勬噰闁诡喒鍓濋幆鏃堟晲鎼存繄闂繝鐢靛Х閺佹悂宕戦悙宸劷婵炲棙鎼╅弫鍕煕閵夈垺娅呴柛銊︾箞閺屾洘绻涢悙顒佺彅闂佸憡鍨规慨鐢垫崲濠靛洨绡€闁稿本渚楀Λ銈呪攽閻愯尙澧曢柣鏍с偢瀵鈽夊Ο閿嬬€婚棅顐㈡处閹告挳宕戦幘璇查唶闁哄洨鍋熼崝?
const ASYNC_RULES = {
  maxSyncCandidates: 8000,
  maxSyncAreaKm2WithRefine: 20
}

// Lazy-load legacy Node executor only when fallback is required.
// This keeps gateway startup lean when Python is the primary compute path.
let cachedLegacyExecuteQuery = null

async function getLegacyExecuteQuery() {
  if (typeof cachedLegacyExecuteQuery === 'function') {
    return cachedLegacyExecuteQuery
  }

  const legacyModule = await import('../routes/ai/executor.js')
  if (typeof legacyModule.executeQuery !== 'function') {
    throw new Error('legacy Node executor is unavailable')
  }

  cachedLegacyExecuteQuery = legacyModule.executeQuery
  return cachedLegacyExecuteQuery
}

const ADVANCED_QUERY_TYPES = new Set([
  'area_analysis',
  'fuzzy_regions',
  'vernacular_region',
  'graph_reasoning',
  'region_comparison'
])

function normalizeQueryType(queryPlan = {}) {
  const rawType = queryPlan?.query_type || queryPlan?.queryType || 'poi_search'
  return String(rawType).trim().toLowerCase() || 'poi_search'
}

const LEGACY_VISUAL_MODEL_ALIASES = new Map([
  ['qwen3-vl-4b', 'qwen/qwen3-vl-4b']
])

function upgradeLegacyVisualModelAlias(modelName = '') {
  const normalized = String(modelName || '').trim()
  if (!normalized) return ''
  return LEGACY_VISUAL_MODEL_ALIASES.get(normalized.toLowerCase()) || normalized
}

export function normalizeVisualModelName(modelName, { fallback = 'qwen/qwen3-vl-4b' } = {}) {
  const explicitModel = upgradeLegacyVisualModelAlias(modelName)
  if (explicitModel) {
    return explicitModel
  }

  const envModel = upgradeLegacyVisualModelAlias(
    process.env.LOCAL_VISUAL_MODEL
    || process.env.LOCAL_VLM_MODEL
    || process.env.LOCAL_LLM_MODEL
    || process.env.LLM_MODEL
  )

  if (envModel) {
    return envModel
  }

  return upgradeLegacyVisualModelAlias(fallback) || 'qwen/qwen3-vl-4b'
}


// 缂傚倸鍊搁崐鎼佸磹閹间礁纾圭憸鐗堝笒缁犱即鏌熼梻瀵稿妽闁稿鍊濋弻鏇熺箾閻愵剚鐝旂紓浣插亾闁割偀鎳囬崑鎾荤嵁閸喖濮庡┑鈽嗗亝缁嬫挾鍒掓繝姘婵°倓鑳堕崢鍨繆閻愬樊鍎忛悗娑掓櫊閹偟鎹勯妸褏锛滈梺閫炲苯澧€垫澘瀚伴獮鍥敇閻斿摜褰ㄩ梺璇查閸樻粓宕戦幘缁樼厱闁哄洢鍔嬬花鐣岀磼鏉堛劌鍝烘慨濠呮缁瑧鎹勯妸褜鍞剁紓鍌欑椤︿即骞愰幎鐣屽祦闁告劑鍓弮鍫濈妞ゅ繐妫寸槐鍙変繆閻愵亜鈧牠骞愭ィ鍐ㄧ；婵炴垯鍨归悿楣冩煕濞戞﹫鍔熺紒鐘插⒔缁辨捇宕奸姀鐘橆剟鏌涜箛鎾剁劯闁哄苯绉归幊锟犲Χ閸涱厺绮梺杞扮閻楁捇寮诲澶婄厸濞达絽鎲″▓鍫曟⒑閸涘鐒藉┑顕€顥撳Σ鎰板箻鐠囪尙锛滃┑鐐村灦閻熴儳鍠婂澶嬧拺閻庣櫢闄勫妯讳繆閸ф鐓冪憸婊堝礈濞戙垹鏋侀柟闂撮檷閳ь兛鐒︾换婵嬪炊閵娿儳妯侀梻浣告啞濞诧箓宕归幏宀€绠?
function cloneForCache(payload) {
  if (!payload) return payload

  try {
    return structuredClone(payload)
  } catch {
    return JSON.parse(JSON.stringify(payload))
  }
}

// 濠电姷鏁搁崑娑㈩敋椤撶喐鍙忛柟缁㈠枛缁犵娀骞栫划瑙勵潐闁肩増瀵ч妵鍕疀閹炬惌妫ら梺娲诲幗閻熲晠寮诲☉銏犵疀妞ゆ牗姘ㄥВ銏ゆ⒑閸濆嫭顥欓柛妤佸▕瀵鏁嶉崟顏呭媰闁荤姴娲﹁ぐ鍐╂叏閵堝拋娓婚柕鍫濇缁€鍐┿亜閵娿儳澧﹂柟顕呭櫍瀹曟粏顦抽悗姘哺閺屻倗鍠婇崡鐐插箣闂佺顑嗛幑鍥箖濠婂牊瀵犲璺哄珐閺囩儐娓婚柕鍫濇婢ь剛绱掗鑲┬х€殿喖鐤囩粻娑㈠即閻樼绱抽梻浣侯焾閺堫剛绮欓幒鏂剧剨妞ゆ挶鍨洪悡鐔煎箳閹惰棄绀夐柟杈剧畱閺嬩胶鈧箍鍎卞ú锝呪柦椤忓牊鐓曢柟鐐殔閹虫劕鐣垫担鍦瘈闁汇垽娼ф禒锕傛煙閸涘﹥鍊愭鐐诧躬楠炲洭顢欓挊澶夌病婵＄偑鍊栭崝鎴﹀磹閺嶎偀鍋撳顓炲摵婵﹥妞藉畷褰掝敋閸涱厼澹嬫繝鐢靛Л閸嬫捇鏌熺紒銏犳灍闁绘挾鍠栭弻宥嗘姜閹峰苯鍘￠梺鍦櫕婵炩偓闁诡喕绮欓、娑橆潩閻撳孩顔嶉梻浣告贡閹虫挾鈧凹鍣ｉ崺鈧い鎺嗗亾婵犫偓鏉堛劍鍙忓瀣捣娑撳秹鏌″搴″箺闁?
function shouldUseSpatialResultCache(queryPlan = {}, options = {}) {
  if (options?.skipCache || options?.forceRefresh) return false

  const cacheInDev = String(process.env.SPATIAL_CACHE_IN_DEV || 'true').trim().toLowerCase()
  const allowCacheInDev = ['1', 'true', 'yes', 'on'].includes(cacheInDev)
  if (process.env.NODE_ENV !== 'production' && !allowCacheInDev) {
    return false
  }

  const queryType = normalizeQueryType(queryPlan)
  if (queryType === 'clarification_needed') return false

  return true
}

// Cache fingerprint includes source_policy + userQuestion to avoid stale cross-query reuse.
function buildSpatialCacheFingerprint(queryPlan = {}, spatialContext = {}, options = {}, userQuestion = '') {
  return queryCache.generateQueryFingerprint(queryPlan, spatialContext, {
    sourcePolicy: options?.sourcePolicy || null,
    queryType: normalizeQueryType(queryPlan),
    route: 'spatial_job_runner',
    userQuestion
  })
}

// Migration closeout rule: advanced spatial queries should stay on Python.
// Legacy Node executor is allowed only for explicit forceNodeFallback or legacy policy.
function shouldUseMinimalNodeFallback(queryPlan = {}, options = {}) {
  if (options.forceNodeFallback === true || options.forceLocalExecutor === true) {
    return false
  }

  const policy = String(process.env.SPATIAL_NODE_ADVANCED_FALLBACK || 'minimal').trim().toLowerCase()
  if (policy === 'legacy' || policy === 'always') {
    return false
  }

  if (policy === 'disabled') {
    return true
  }

  return ADVANCED_QUERY_TYPES.has(normalizeQueryType(queryPlan))
}


function shouldUseLegacyNodeExecutor(options = {}) {
  if (options.forceLegacyNodeExecutor === true) {
    return true
  }

  const envFlag = String(process.env.SPATIAL_NODE_LEGACY_EXECUTOR || 'false').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(envFlag)
}

function emptyGraphReasoningSummary() {
  return {
    node_count: 0,
    edge_count: 0,
    component_count: 0,
    components: [],
    top_hubs: [],
    avg_degree: 0,
    distance_threshold_m: 280
  }
}

function buildMinimalNodeFallbackEnvelope(queryPlan = {}, fallbackReasons = []) {
  const queryType = normalizeQueryType(queryPlan)
  const fallbackPolicy = String(process.env.SPATIAL_NODE_ADVANCED_FALLBACK || 'minimal').trim().toLowerCase()

  return {
    success: true,
    results: {
      mode: 'node-minimal-fallback',
      pois: [],
      boundary: null,
      spatial_clusters: { hotspots: [] },
      target_regions: [],
      region_analyses: [],
      comparison: null,
      vernacular_regions: [],
      fuzzy_regions: [],
      graph_reasoning: emptyGraphReasoningSummary(),
      stats: {
        total_candidates: 0,
        cluster_count: 0,
        query_type: queryType,
        executor_engine: 'node_minimal_fallback',
        fallback_policy: fallbackPolicy,
        degraded: true
      }
    },
    diagnostics: {
      engine: 'node-minimal-fallback',
      query_type: queryType,
      fallback_reasons: fallbackReasons
    }
  }
}

/**
 */
/**
 * 闂傚倷娴囬褍霉閻戣棄绠犻柟鎯у殺閸ヮ剦鏁嶉柣鎰皺閻撴垿妫呴銏″缂佸鍨垮鍛婄瑹閳ь剟寮婚埄鍐ㄧ窞閹兼番鍨婚妴濠囨⒑閸︻厽娅曢柛鐘崇墪椤曪綁宕奸弴鐔封偓濠氭煕閳╁喚娈旀い顐邯閹鎲撮崟顒傤槰闂佺粯鎼换婵嗩嚕椤愩埄鍚嬮柛娑卞灡濞堟洟姊洪崨濠冨闁稿海鍏橀崺锟犲磼濞戞ê浼?NaN 濠电姷鏁搁崑鐔妓夐幇鏉跨；闁归偊鍘介崣蹇涙煟閵忕姵鍟為柛瀣€块幃妤呮晲鎼粹剝鐏堥柣鐔哥懕缁犳捇鐛弽銊︾秶闁告挆鍕还闂備浇妗ㄧ欢姘辩不閺嶎厼绠栭悷娆忓閻熺懓鈹戦悩鎻掝伀闁挎稓鍠栧鐑樺濞嗘垵鍩屽銈庡弮閺€杈ㄧ┍?
 */
function toNumeric(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/**
 */
/**
 * 闂傚倷娴囬褏鎹㈤幇顔藉床闁归偊鍎靛☉妯锋闁靛繒濮烽敍娑㈡⒑閹稿海绠撴い锔诲灦閺屻劑濡舵径瀣幍闂備緡鍙忕粻鎴︾嵁濮椻偓閺屾盯濡搁妸銉ゆ睏缂備浇椴搁幐濠氬箯閸涙潙浼犻柛鏇ㄥ墰閳ь剝娅ｇ槐鎾存媴鐟欏嫧鎷归梺鐟版啞婵炲﹪鎮?{lon, lat}闂?
 */
function normalizePoint(input) {
  if (!input) return null

  if (Array.isArray(input) && input.length >= 2) {
    const lon = toNumeric(input[0], NaN)
    const lat = toNumeric(input[1], NaN)
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat }
    }
    return null
  }

  const lon = toNumeric(input.lon ?? input.lng ?? input.longitude, NaN)
  const lat = toNumeric(input.lat ?? input.latitude, NaN)
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return { lon, lat }
  }

  return null
}

/**
 */
/**
 * Haversine 闂傚倸鍊峰ù鍥х暦閻㈢纾绘繛鎴欏灩閻ゎ噣鏌℃径瀣劸闁绘帊绮欓弻鐔封枔閸喗鐏嶉悗瑙勬礀椤︽壆鎹㈠┑瀣棃婵炴垶鑹鹃埛鍫ユ⒑鐠囨彃顒㈤柣鎿勭節瀵濡搁妷銏☆潔濠碘槅鍨甸褎鏅堕ˇ鎾绘⒒閸屾瑧鍔嶉悗绗涘懐鐭欓柟娆¤娲、姗€濮€閻橀潧濮?
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 */
/**
 * 濠电姷鏁搁崑鐐差焽濞嗘挸瑙﹂悗锝庡亞閻濆爼鏌涢埄鍐姇闁?viewport 闂傚倸鍊搁崐鎼佸磹閹间焦鍋嬮柛鏇ㄥ灠閸ㄥ倿鏌￠崟顐ょ畾闁告瑩绠栧缁樻媴閻熼偊鍤嬬紓浣割儐閸ㄧ敻鈥﹂崶顑濈兘骞庨懞銉у弰闂婎偄娲﹂幐鍓х不婵犳碍鐓涘ù锝呮憸鏍￠悗鍨緲鐎氭澘鐣烽悡搴僵妞ゆ垵鐏濋ˉ?
 */
function viewportAreaKm2(viewport) {
  if (!Array.isArray(viewport) || viewport.length < 4) {
    return 0
  }

  const minLon = toNumeric(viewport[0], NaN)
  const minLat = toNumeric(viewport[1], NaN)
  const maxLon = toNumeric(viewport[2], NaN)
  const maxLat = toNumeric(viewport[3], NaN)

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    return 0
  }

  const midLat = (minLat + maxLat) / 2
  const midLon = (minLon + maxLon) / 2

  const widthKm = haversineKm(midLat, minLon, midLat, maxLon)
  const heightKm = haversineKm(minLat, midLon, maxLat, midLon)

  return Math.max(0, widthKm * heightKm)
}

/**
 */
/**
 * 濠电姷鏁搁崑鐐差焽濞嗘挸瑙﹂悗锝庡亞閻濆爼鏌涢埄鍐姇闁?polygon 闂傚倸鍊搁崐鎼佸磹閹间焦鍋嬮柛鏇ㄥ灠閸ㄥ倿鏌￠崟顐ょ畾闁告瑩绠栧缁樻媴閻熼偊鍤嬬紓浣割儐閸ㄧ敻鈥﹂崶顑濈兘骞庨懞銉у弰闂婎偄娲﹂幐鍓х不婵犳碍鐓涘ù锝呮憸鏍￠悗鍨緲鐎氼剟鍩ユ径濠庢僵濡插本鐗楀暩濠电姷鏁搁崑娑㈩敋椤撶喐鍙忛柟缁㈠枛缁犵娀鏌熼悧鍫熺凡闁哄绶氶弻鏇㈠醇濠靛浂妫ゅ銈傛櫆閻擄繝鐛弽顐㈠灊闁稿繐顦禍鍓р偓瑙勬礀濞茬娀宕戦幘鍓佺＜婵☆垵鍋愰鏇犵磽閸屾氨澧㈠┑顔惧厴钘濋柨鏇炲€归悡鏇㈡煏婵炲灝鈧鎯屽▎鎴斿亾濞堝灝娅橀柛鎾跺枛閵嗕礁螣鐞涒剝鏁犻梺璇″瀻閸屾凹妫?
 */
function polygonAreaKm2(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    return 0
  }

  const points = boundary
    .map(normalizePoint)
    .filter(Boolean)

  if (points.length < 3) {
    return 0
  }

  const refLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const metersPerDegreeLat = 111_320
  const metersPerDegreeLon = 111_320 * Math.cos((refLat * Math.PI) / 180)

  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]
    const current = points[i]

    const x1 = current.lon * metersPerDegreeLon
    const y1 = current.lat * metersPerDegreeLat
    const x2 = next.lon * metersPerDegreeLon
    const y2 = next.lat * metersPerDegreeLat

    area += x1 * y2 - x2 * y1
  }

  return Math.abs(area / 2) / 1_000_000
}

/**
 */
/**
 * 濠?spatialContext 闂傚倸鍊风粈浣革耿鏉堚晛鍨濇い鏍仜缁€澶愭煛閸ゅ爼顣﹀Ч妤呮⒑閹肩偛鍔撮柛鎾寸懅缁鏁愭径瀣幐閻庡箍鍎辩换鎺楁偩鏉堚斁鍋撳▓鍨珝妞ゃ儲鎸惧Σ鎰板箳濡や礁浜归梺褰掝暒閻掞箓鎮鹃悜鑺モ拺缂備焦蓱閹牏绱掓潏銊︾妤犵偛绻橀幃鈺冩嫚瀹割喗缍傞梻渚€娼ч悧鍡椢涘▎鎾澄ラ柛鎰典簽绾捐棄霉閿濆懎顥忔俊顖氱墦閺屾盯鈥﹂幋婵嗏拫闂佺硶鏂侀崑?
 */
function deriveSpatialAreaKm2(spatialContext = {}) {
  if (!spatialContext || typeof spatialContext !== 'object') {
    return 0
  }

  if (spatialContext.mode?.toLowerCase() === 'circle' && spatialContext.radius) {
    const radiusKm = toNumeric(spatialContext.radius, 0) / 1000
    if (radiusKm > 0) {
      return Math.PI * radiusKm * radiusKm
    }
  }

  if (Array.isArray(spatialContext.boundary) && spatialContext.boundary.length >= 3) {
    return polygonAreaKm2(spatialContext.boundary)
  }

  if (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    return viewportAreaKm2(spatialContext.viewport)
  }

  return 0
}

/**
 */
/**
 * 婵犵數濮烽。钘壩ｉ崨鏉戠；闁逞屽墴閺屾稓鈧綆鍋呭畷宀勬煛瀹€瀣？濞寸媴濡囬幏鐘诲箵閹烘埈娼ュ┑鐘殿暯閳ь剙鍟跨痪褔鏌熼鐓庘偓鎼佹偩閻戣棄唯闁冲搫鍊瑰▍鍡涙⒑閸忛棿鑸柛搴㈠▕閹箖骞庨懞銉㈡嫼闁哄鍋炴竟鍡浰囬敃鍌涚厽婵°倐鍋撶紒缁橈耿瀹曟椽鎮欓崫鍕敤濡炪倖鎸鹃崯鍧楀箯婵犳碍鐓熼幖杈剧稻閺嗏晜銇勯鐐靛ⅵ妞ゃ垺鐟︾换婵嬪炊閵娧冨箰濠电姰鍨煎▔娑㈡嚐椤栫偛鍑犻柛宀€鍋為悡?
 */
function hasSpatialContext(spatialContext = {}) {
  if (!spatialContext || typeof spatialContext !== 'object') {
    return false
  }

  return (
    (Array.isArray(spatialContext.boundary) && spatialContext.boundary.length >= 3) ||
    (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) ||
    (spatialContext.center && spatialContext.radius)
  )
}

/**
 */
/**
 * 闂傚倸鍊风粈渚€宕ョ€ｎ喖纾块柟鎯版鎼村﹪鏌ら懝鎵牚濞存粌缍婇弻娑㈠Ψ閵忊剝鐝曢梺鍝ュТ濡繈寮诲☉銏犵労闁告劗鍋撻悾鍓佺磽閸屾氨校闁瑰憡鎮傞崺銉﹀緞閹邦剛顔撻梺鍛婂姂閸斿瞼绮婚崷顓犵＝濞达綀顫夐妵婵堢磼閻樺磭澧垫鐐插暙閳诲酣骞橀弶鎴濆闂備礁鎲＄缓鍧楀磿閹跺壙鍥敊閻ｅ瞼顔?Planner 濠电姷鏁搁崑鐘诲箵椤忓棗绶ら柛鎾楀啫鐏婇梺鍓插亖閸ㄨ櫣鈧艾顭烽弻锝夊棘閹稿骸鏆堢紓鍌氱Т濞差參寮诲☉妯锋闁告鍋涚粻褰掓偠濮樺崬校缂佺粯鐩獮瀣倷閺夋垹顣查梻浣瑰濞测晝寰婄捄銊ュ灊妞ゆ挶鍨瑰婵嬫煛婢跺鐏︽い銉︾箞濮婃椽骞栭悙鎻掑闂佺瀵掗崳锝呯暦?
 */

function getViewportCenter(spatialContext = {}) {
  if (Array.isArray(spatialContext.viewport) && spatialContext.viewport.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = spatialContext.viewport
    return {
      lon: (toNumeric(minLon, 0) + toNumeric(maxLon, 0)) / 2,
      lat: (toNumeric(minLat, 0) + toNumeric(maxLat, 0)) / 2
    }
  }

  if (spatialContext.center) {
    return normalizePoint(spatialContext.center)
  }

  return null
}

/**
 */
/**
 * 婵犵數濮烽。钘壩ｉ崨鏉戠；闁逞屽墴閺屾稓鈧綆鍋呯亸鎵磼缂佹娲寸€殿喖鐖奸獮瀣敇閻愭彃顥撻梻鍌欑窔濞艰崵寰婃禒瀣婵犲﹤鐗嗙粻顖炴倵閿濆骸鏋熼柡鍜佸墴閺屾盯寮撮妸銉ョ濠殿噯绲介悧鎾愁潖濞差亜宸濆┑鐘插暊閹峰姊洪崫銉バｆ繛鑼枎閻ｅ嘲螖閳ь剟锝炲鍫濈劦妞ゆ巻鍋撴い鏇稻缁傛帞鈧綆浜為崐鐐差渻閵堝懐绠扮紒澶嬫尦瀵偉銇愰幒鎾嫼闂佸湱顭堝ù鐑藉煡婢跺绠鹃柛蹇曗拡閸旀Ωzy/vernacular/濠电姴鐥夐弶搴撳亾閺囥垹纾圭憸鐗堝坊閳ь剨绠撳畷鍫曞煛閸曨倣锟犳⒑缁夊棗瀚峰▓鏃傗偓鐟版啞缁诲牓寮婚敃鈧灒濞撴凹鍨辨晥闂備胶顭堥敃銉︾箾婵犲洤钃熼柕濞垮劗濡插牊鎱ㄥΔ鈧Λ娆掑€撮梻?
 */
function detectHeavyFeatureFlags(options = {}, queryPlan = {}) {
  const wantsFuzzy =
    options.enableFuzzyRegion === true ||
    options.enable_fuzzy_region === true ||
    queryPlan.need_fuzzy_region === true

  const wantsVernacular =
    options.enableVernacularRegion === true ||
    options.enable_vernacular_region === true ||
    queryPlan.need_vernacular_region === true

  const needHighPrecisionNaming =
    options.highPrecisionNaming === true || options.needHighPrecisionNaming === true

  return {
    wantsFuzzy,
    wantsVernacular,
    needHighPrecisionNaming
  }
}

/**
 */
/**
 * 闂?messages 濠电姷鏁搁崑鐐哄垂閸洖绠归柍鍝勬噹閸屻劑鏌﹀Ο渚Ф闁逞屽墯鐢€崇暦婵傜鍗抽柣鎰礋閺囥垺鐓欓柣鎾虫捣閹界姷绱掔拠鎻掝伃妞ゃ垺妫冮弻鍡楊吋閸℃瑥骞?user 闂傚倸鍊风粈浣革耿鏉堚晛鍨濇い鏍仜缁€澶嬬箾閸℃绨挎繛鎴欏灩闁卞洭鏌￠崶鈺佲偓?
 */
export function extractLastUserMessage(messages = []) {
  const last = messages.filter((item) => item?.role === 'user').pop()
  return last?.content || ''
}

/**
 */
/**
 * 闂?闂傚倸鍊搁崐鐑芥倿閿曚降浜归柛鎰典簽閻捇鏌熺紒銏犳灈闁搞劌鍊块獮鏍垝閻熸壆鍘柣鐔哥懃鐎氼厽鍒婇幘顔界叄闊洦鍑瑰鎰版煙閸欏鍊愭慨濠勫劋鐎电厧鈻庨幋鐘仭闂備胶顭堢€垫帡宕归崼鏇炴槬闁?
 * 闂傚倷绀侀幖顐λ囬锕€鐤炬繝濠傜墕閽冪喖鏌曟繛鍨壄?mode + reasons + metrics闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟瀵稿仧闂勫嫰鏌￠崘銊モ偓濠氭儗濮樿埖鐓犻柛婵勫劜閺嗏晜銇勯埡鍌滃弨妤犵偞鐗曡彁妞ゆ垼娉曠粈鍌炴⒑閸︻厼鍔嬫い銊ユ閹繝宕掑锝嗘杸闂佺粯鍔樼亸娆忣潩閵娾晜鐓?
 */
/**
 * Detect greeting-only messages to avoid unnecessary spatial compute + long LLM latency.
 */
function isSmallTalkQuestion(question = '') {
  const normalized = String(question).trim().toLowerCase()
  if (!normalized) return false

  const compact = normalized.replace(/[\s,.!?]/g, '')
  const smallTalkSet = new Set([
    '\u4f60\u597d',     // nihao
    '\u60a8\u597d',     // ninhao
    '\u55e8',             // ?
    '\u54c8\u55bd',     // halou
    '\u5728\u5417',     // zaima
    '\u5728\u4e0d\u5728', // zaibuzai
    'hi',
    'hello',
    'hey'
  ])

  return smallTalkSet.has(compact)
}

const GENERAL_QA_PROMPT_VERSION = '2026-02-26.general_qa.v3'

const GENERAL_QA_SYSTEM_PROMPT = [
  'You are GeoLoom assistant for this product only.',
  'Use plain Chinese and keep answers practical, concise, and system-specific.',
  'Important constraints:',
  '- Do not trigger or assume spatial operators in this mode.',
  '- Do not claim unsupported capabilities (global encyclopedic lookup, real-time internet facts, external DB access).',
  '- Focus on this system: viewport/boundary based POI analysis, clustering hotspots, category structure, region comparison, and actionable conclusions.',
  '- If user asks for question templates/examples, provide exactly 6 high-quality examples and each with an executable conclusion.',
  '- Avoid generic marketing copy.'
].join('\n')

function normalizeGeneralQaText(question = '') {
  return String(question || '').trim().toLowerCase()
}

export function detectGeneralQaPresetType(question = '') {
  const normalized = normalizeGeneralQaText(question)
  if (!normalized) return null
  const compact = normalized.replace(/\s+/g, '')

  const asksExamples = (
    /(\u793a\u4f8b|\u4f8b\u5b50|\u6a21\u677f|prompt|template)/i.test(compact) &&
    /(\u95ee\u9898|\u95ee\u6cd5|question|query)/i.test(compact)
  ) || /(\u600e\u4e48\u63d0\u95ee|\u5982\u4f55\u63d0\u95ee|\u95ee\u6cd5\u5efa\u8bae)/i.test(compact)
  if (asksExamples) return 'examples'

  const asksCapability = /(\u4f60\u662f\u8c01|\u4f60\u80fd\u505a\u4ec0\u4e48|\u80fd\u529b|\u652f\u6301\u4ec0\u4e48|whoareyou|whatcanyoudo|help)/i.test(compact)
  if (asksCapability) return 'capability'

  const asksUsage = /(\u600e\u4e48\u7528|\u5982\u4f55\u4f7f\u7528|\u4f7f\u7528\u65b9\u6cd5|\u64cd\u4f5c\u6b65\u9aa4|\u4e0a\u624b)/i.test(compact)
  if (asksUsage) return 'usage'

  return null
}

export function buildGeneralQaPresetReply(question = '') {
  const presetType = detectGeneralQaPresetType(question)

  if (presetType === 'examples') {
    return [
      '\u4e0b\u9762\u662f\u57fa\u4e8e\u5f53\u524d\u5730\u56fe\u89c6\u7a97/\u7cfb\u7edf\u80fd\u529b\u7684 6 \u4e2a\u9ad8\u8d28\u91cf\u5730\u7406\u7a7a\u95f4\u63d0\u95ee\u793a\u4f8b\uff08\u6bcf\u4e2a\u90fd\u5bf9\u5e94\u53ef\u6267\u884c\u7ed3\u8bba\uff09\uff1a',
      '',
      '1. \u95ee\u9898\uff1a\u5728\u5f53\u524d\u5730\u56fe\u89c6\u7a97\u5185\uff0c\u54ea\u4e9b\u8857\u533a\u7684\u9910\u996e\u4f9b\u7ed9\u8fc7\u5bc6\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u8f93\u51fa\u201c\u8fc7\u5ea6\u7ade\u4e89\u7247\u533a\u201d\u6e05\u5355\uff0c\u4f5c\u4e3a\u9009\u5740\u907f\u5751\u533a\u57df\u3002',
      '',
      '2. \u95ee\u9898\uff1a\u5728\u81ea\u5b9a\u4e49\u8fb9\u754c\u5185\uff0c\u54ea\u4e9b\u7f51\u683c\u751f\u6d3b\u670d\u52a1\u4f9b\u7ed9\u7f3a\u53e3\u6700\u5927\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u751f\u6210\u201c\u4f18\u5148\u8865\u4f4d\u7247\u533a\u201d\u6392\u5e8f\u4e0e\u5efa\u8bae\u4e1a\u6001\u3002',
      '',
      '3. \u95ee\u9898\uff1a\u4e24\u4e2a\u5df2\u9009\u533a\u57df\u5728\u4e3b\u5bfc\u4e1a\u6001\u7ed3\u6784\u4e0a\u7684\u6838\u5fc3\u5dee\u5f02\u662f\u4ec0\u4e48\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u5f62\u6210\u201cA \u533a vs B \u533a\u201d\u62db\u5546\u7b56\u7565\u5dee\u5f02\u8868\u3002',
      '',
      '4. \u95ee\u9898\uff1a\u5f53\u524d\u53ef\u89c1\u8303\u56f4\u5185\uff0c\u54ea\u4e9b\u70ed\u70b9\u805a\u7c7b\u7247\u533a\u5177\u5907\u589e\u91cf\u5e97\u94fa\u6761\u4ef6\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u7ed9\u51fa Top N \u5019\u9009\u533a\u57df\u53ca\u5bf9\u5e94\u5f00\u5e97\u7c7b\u76ee\u5efa\u8bae\u3002',
      '',
      '5. \u95ee\u9898\uff1a\u6309\u7167\u6307\u5b9a\u7c7b\u522b\u7b5b\u9009\u540e\uff0c\u54ea\u4e9b\u7247\u533a\u7684\u4e1a\u6001\u7ec4\u5408\u6700\u5931\u8861\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u8f93\u51fa\u201c\u8c03\u6574\u4f18\u5148\u7ea7\u201d\u4e0e\u7c7b\u76ee\u8865\u9f50\u6e05\u5355\u3002',
      '',
      '6. \u95ee\u9898\uff1a\u5728\u5f53\u524d\u57ce\u533a\u4e2d\uff0c\u54ea\u4e9b\u7247\u533a\u9002\u5408\u505a\u4e3a\u201c\u793e\u533a\u4fbf\u6c11\u670d\u52a1\u201d\u8bd5\u70b9\uff1f',
      '   \u53ef\u6267\u884c\u7ed3\u8bba\uff1a\u7ed9\u51fa 2-3 \u4e2a\u8bd5\u70b9\u7247\u533a\u4e0e\u843d\u5730\u5148\u540e\u987a\u5e8f\u3002'
    ].join('\n')
  }

  if (presetType === 'usage') {
    return [
      '\u8fd9\u4e2a\u7cfb\u7edf\u7684\u6700\u4f73\u4f7f\u7528\u65b9\u5f0f\u662f\uff1a\u5148\u6846\u5b9a\u5730\u56fe\u8303\u56f4\uff08\u89c6\u7a97\u6216\u81ea\u5b9a\u4e49\u8fb9\u754c\uff09\uff0c\u518d\u95ee\u4e1a\u52a1\u95ee\u9898\u3002',
      '',
      '\u5efa\u8bae\u63d0\u95ee\u6a21\u677f\uff1a',
      '1. \u201c\u5728[\u5f53\u524d\u89c6\u7a97/\u6307\u5b9a\u533a\u57df]\u5185\uff0c[\u54ea\u7c7b POI/\u54ea\u79cd\u4e1a\u6001]\u7684\u7a7a\u95f4\u5206\u5e03\u6709\u4ec0\u4e48\u7279\u70b9\uff1f\u201d',
      '2. \u201c\u5bf9\u6bd4[\u533a\u57dfA]\u548c[\u533a\u57dfB]\u7684[\u4e1a\u6001/\u6d3b\u529b/\u4f9b\u7ed9\u7ed3\u6784]\uff0c\u4e3b\u8981\u5dee\u5f02\u662f\u4ec0\u4e48\uff1f\u201d',
      '3. \u201c\u57fa\u4e8e\u5f53\u524d\u8303\u56f4\uff0c\u7ed9\u6211[\u9009\u5740/\u8865\u70b9/\u62db\u5546]\u7684\u53ef\u6267\u884c\u5efa\u8bae\u6e05\u5355\u3002\u201d'
    ].join('\n')
  }

  return [
    '\u6211\u662f GeoLoom \u7684\u5bf9\u8bdd\u5206\u6790\u52a9\u624b\uff0c\u53ea\u56de\u7b54\u4e0e\u5f53\u524d\u7cfb\u7edf\u80fd\u529b\u5339\u914d\u7684\u95ee\u9898\u3002',
    '',
    '\u6211\u80fd\u5e2e\u4f60\uff1a',
    '- \u89e3\u8bfb\u5f53\u524d\u89c6\u7a97/\u81ea\u5b9a\u4e49\u8fb9\u754c\u5185\u7684 POI \u5206\u5e03\u4e0e\u4e1a\u6001\u7ed3\u6784\uff1b',
    '- \u8f93\u51fa\u70ed\u70b9\u805a\u7c7b\u3001\u533a\u57df\u5bf9\u6bd4\u548c\u53ef\u6267\u884c\u5efa\u8bae\uff1b',
    '- \u7ed9\u51fa\u9762\u5411\u9009\u5740/\u8fd0\u8425/\u62db\u5546\u7684\u9ad8\u8d28\u91cf\u63d0\u95ee\u6a21\u677f\u3002',
    '',
    '\u4e0d\u652f\u6301\uff1a\u8131\u79bb\u5f53\u524d\u7cfb\u7edf\u6570\u636e\u7684\u767e\u79d1\u7c7b\u95ee\u7b54\u3001\u5b9e\u65f6\u4e92\u8054\u7f51\u67e5\u8be2\u3002',
    '\u4e3a\u4e86\u7ed3\u679c\u66f4\u51c6\uff0c\u8bf7\u5c3d\u91cf\u6307\u5b9a\u5730\u56fe\u8303\u56f4\uff08\u89c6\u7a97/\u8fb9\u754c\uff09\u3001\u5173\u6ce8\u7c7b\u522b\u548c\u5206\u6790\u76ee\u6807\u3002'
  ].join('\n')
}

function buildGeneralQaFallback(question = '') {
  return buildGeneralQaPresetReply(question)
}

async function generateGeneralQaAnswer({ userQuestion, messages = [] } = {}) {
  const presetType = detectGeneralQaPresetType(userQuestion)
  if (presetType) {
    return {
      text: buildGeneralQaPresetReply(userQuestion),
      source: `preset_${presetType}`,
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }

  const allowGeneralQaLlm = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.GENERAL_QA_ALLOW_LLM || 'false').trim().toLowerCase()
  )
  if (!allowGeneralQaLlm) {
    return {
      text: buildGeneralQaFallback(userQuestion),
      source: 'preset_default',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }

  const history = Array.isArray(messages)
    ? messages
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content || '').trim()
      }))
      .filter((item) => item.content.length > 0)
      .slice(-8)
    : []

  const hasLatestUserQuestion = history.length > 0 && history[history.length - 1].role === 'user'
  const llmMessages = [
    { role: 'system', content: GENERAL_QA_SYSTEM_PROMPT },
    ...history,
    ...(hasLatestUserQuestion ? [] : [{ role: 'user', content: String(userQuestion || '').trim() }])
  ]

  try {
    const response = await callLLM({
      messages: llmMessages,
      temperature: 0.35,
      max_tokens: 820,
      stream: false
    })
    const data = await response.json()
    const rawText = data?.choices?.[0]?.message?.content || ''
    const text = normalizeLLMTextReply(rawText)
    return {
      text: text || buildGeneralQaFallback(userQuestion),
      source: 'llm_general_qa',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  } catch (err) {
    console.warn(`[SpatialJobRunner] general_qa LLM failed, fallback used: ${err.message}`)
    return {
      text: buildGeneralQaFallback(userQuestion),
      source: 'fallback_general_qa',
      promptVersion: GENERAL_QA_PROMPT_VERSION
    }
  }
}

function isGeneralQaQueryPlan(queryPlan = {}) {
  return String(queryPlan?.query_type || '').trim().toLowerCase() === 'general_qa'
}

function isIrrelevantQueryPlan(queryPlan = {}) {
  return String(queryPlan?.query_type || '').trim().toLowerCase() === 'irrelevant_input'
}

/**
 */
export function decideExecutionMode({
  spatialContext = {},
  queryPlan = null,
  options = {},
  estimatedPoiCount = 0
} = {}) {
  if (options.forceSync === true) {
    return {
      mode: 'sync',
      reasons: ['forceSync enabled'],
      metrics: {
        area_km2: deriveSpatialAreaKm2(spatialContext),
        estimated_candidates: estimatedPoiCount
      }
    }
  }

  if (options.forceAsync === true) {
    return {
      mode: 'async',
      reasons: ['forceAsync enabled'],
      metrics: {
        area_km2: deriveSpatialAreaKm2(spatialContext),
        estimated_candidates: estimatedPoiCount
      }
    }
  }

  const reasons = []
  const areaKm2 = deriveSpatialAreaKm2(spatialContext)
  const estimate = toNumeric(estimatedPoiCount, 0)
  const flags = detectHeavyFeatureFlags(options, queryPlan || {})

  const queryType = queryPlan?.query_type || options.queryType || null
  const needsGlobal = queryPlan?.need_global_context === true || options.need_global_context === true
  const needBoundaryRefine =
    options.needBoundaryRefine === true ||
    options.needBoundaryRefine === true ||
    options.enableBoundaryRefine === true ||
    queryType === 'area_analysis'

  if (estimate > ASYNC_RULES.maxSyncCandidates) {
    reasons.push(`candidate_poi>${ASYNC_RULES.maxSyncCandidates}`)
  }

  if (areaKm2 > ASYNC_RULES.maxSyncAreaKm2WithRefine && needBoundaryRefine) {
    reasons.push(`area>${ASYNC_RULES.maxSyncAreaKm2WithRefine}km2_with_refine`)
  }

  if (flags.wantsFuzzy && flags.wantsVernacular) {
    reasons.push('fuzzy_plus_vernacular_enabled')
  }

  if (queryType === 'area_analysis' && needsGlobal) {
    reasons.push('area_analysis_with_global_context')
  }

  if (flags.needHighPrecisionNaming) {
    reasons.push('high_precision_naming')
  }

  return {
    mode: reasons.length > 0 ? 'async' : 'sync',
    reasons,
    metrics: {
      area_km2: Number(areaKm2.toFixed(3)),
      estimated_candidates: estimate,
      query_type: queryType,
      needs_global: needsGlobal,
      needs_boundary_refine: needBoundaryRefine,
      fuzzy: flags.wantsFuzzy,
      vernacular: flags.wantsVernacular
    }
  }
}

/**
 */
/**
 * 闂傚倸鍊风粈渚€骞栭锔绘晞闁告侗鍨崑鎾愁潩椤愩垹绁梺绯曟杹閸?gRPC 闂傚倷娴囧畷鍨叏閺夋嚚娲敇閵忕姷鍝楅梻渚囧墮缁夌敻宕曢幋锔界厽婵°倐鍋撻柣妤€锕ラ崚濠囧箻椤旂晫鍘甸梺缁樺姦閸撴瑩銆傞幎鑺ョ厱?
 */
function serializeCandidatesForGrpc(options = {}, poiFeatures = [], migrationDecision = null) {
  // In python data-source mode, keep candidates empty so Python reads from PostGIS directly.
  const pyDataSource = String(options?.pyDataSource || migrationDecision?.py_data_source || '').toLowerCase()
  if (pyDataSource === 'python') {
    return ''
  }

  // In hybrid mode we may forward candidates, but skip oversized payloads.
  if (typeof options?.candidatesJson === 'string') {
    return options.candidatesJson
  }

  if (!Array.isArray(poiFeatures) || poiFeatures.length === 0) {
    return ''
  }

  if (poiFeatures.length > 2000) {
    return ''
  }

  try {
    return JSON.stringify(poiFeatures)
  } catch {
    return ''
  }
}

function buildGrpcRequest({ requestId, queryPlan, spatialContext, options, migrationDecision, poiFeatures }) {
  const executionProfile = migrationDecision?.execution_profile || 'core'
  const dryRun = migrationDecision?.dry_run === true
  const candidatesJson = serializeCandidatesForGrpc(options, poiFeatures, migrationDecision)
  const resolvedVisualModel = normalizeVisualModelName(options?.visualModel)
  
  // Debug: log what's being sent to Python
  console.log('[GRPC_DEBUG] buildGrpcRequest spatialContext keys:', Object.keys(spatialContext || {}))
  console.log('[GRPC_DEBUG] spatialContext.viewport:', spatialContext?.viewport)
  console.log('[GRPC_DEBUG] spatialContext.boundary:', spatialContext?.boundary ? 'present' : 'missing')
  console.log('[GRPC_DEBUG] spatialContext.regions:', spatialContext?.regions?.length || 0)
  console.log('[GRPC_DEBUG] py_data_source:', migrationDecision?.py_data_source || 'python')
  console.log('[GRPC_DEBUG] candidates_json length:', candidatesJson.length)
  console.log('[GRPC_DEBUG] options.limit/maxFetchLimit:', options?.limit, options?.maxFetchLimit)
  console.log('[GRPC_DEBUG] options.clusterMaxHdbscanPoints/maxRegionOutputs:', options?.clusterMaxHdbscanPoints, options?.maxRegionOutputs)
  console.log('[GRPC_DEBUG] options.visualModel/resolvedVisualModel:', options?.visualModel, resolvedVisualModel)

  return {
    request_id: requestId,
    query_type: queryPlan?.query_type || 'poi_search',
    spatial_context: JSON.stringify(spatialContext || {}),
    categories: Array.isArray(queryPlan?.categories) ? queryPlan.categories : [],
    hints: JSON.stringify({
      query_plan: queryPlan,
      semantic_query: queryPlan?.semantic_query || '',
      options: {
        enableFuzzyRegion: options?.enableFuzzyRegion,
        enableVernacularRegion: options?.enableVernacularRegion,
        needBoundaryRefine: options?.needBoundaryRefine,
        confidenceModel: options?.confidenceModel,
        visualReviewEnabled: options?.visualReviewEnabled,
        visualRemoteEnabled: options?.visualRemoteEnabled,
        selfValidationEnabled: options?.selfValidationEnabled,
        skgEnabled: options?.skgEnabled,
        visualModel: resolvedVisualModel,
        visualEndpoint: options?.visualEndpoint,
        visualTimeoutMs: options?.visualTimeoutMs,
        vlmFailureMode: options?.vlmFailureMode,
        reasoningEnabled: options?.reasoningEnabled,
        reasoningModel: options?.reasoningModel,
        reasoningEndpoint: options?.reasoningEndpoint,
        reasoningTimeoutMs: options?.reasoningTimeoutMs,
        modelBudgetMs: options?.modelBudgetMs,
        syncTimeoutMs: options?.syncTimeoutMs,
        grpcTimeoutMs: options?.grpcTimeoutMs,
        visualSnapshotDataUrl: options?.visualSnapshotDataUrl || options?.mapSnapshotDataUrl || options?.screenshotBase64,
        sourcePolicy: options?.sourcePolicy,
        selectedCategories: options?.selectedCategories,
        regions: Array.isArray(options?.regions) ? options.regions : [],
        limit: options?.limit,
        maxFetchLimit: options?.maxFetchLimit,
        clusterMaxHdbscanPoints: options?.clusterMaxHdbscanPoints,
        maxRegionOutputs: options?.maxRegionOutputs,
        analysisDepth: options?.analysisDepth
      },
      migration: migrationDecision || null
    }),
    mode: options?.mode || 'sync',
    candidates_json: candidatesJson,
    execution_profile: executionProfile,
    dry_run: dryRun
  }
}

/**
 */
/**
 * 闂傚倷娴囬褏鎹㈤幇顔藉床闁归偊鍎靛☉銏犵睄闁稿本绮庨悾鑸电節閵忥絽鐓愰柛鏃€娲滈幉鎾晝閸屾稑鈧爼鏌ｉ幇顓犮偞闁稿鎹囬幃銏☆槹鎼粹€崇瑩闂備浇顕х€涒晠顢欓弽顓炵獥闁哄稁鍋呭畷鏌ユ煙閻戞ê鐏嶉柡?executor 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€哥粻鏉库攽閻樺磭顣查柛濠呮硾椤法鎹勯搹瑙勬婵炲瓨绮岀紞濠囧蓟閻旂厧浼犻柛鏇ㄥ帨閵堝棎浜滈煫鍥ㄧ◥閹查箖鏌＄仦鍓ф创鐎殿喕绮欐俊姝岊槻闁愁亞鏁诲?
 */
function buildGraphAnalysisFromReasoning(graphReasoning = null) {
  if (!graphReasoning || typeof graphReasoning !== 'object') return null

  const edgeCount = Number(graphReasoning.edge_count || 0)
  const avgDegree = Number(graphReasoning.avg_degree || 0)
  const componentCount = Number(graphReasoning.component_count || 0)
  const topHubs = Array.isArray(graphReasoning.top_hubs) ? graphReasoning.top_hubs : []

  const hubs = topHubs.map((hub, index) => ({
    representativePOI: hub?.name || `Hub-${index + 1}`,
    mainCategory: hub?.category || hub?.category_small || hub?.type || 'mixed',
    pageRank: Number.isFinite(edgeCount) && edgeCount > 0
      ? Math.min(1, Math.max(0, Number(hub?.degree || 0) / edgeCount))
      : 0,
    degree: Number(hub?.degree || 0)
  }))

  return {
    global: {
      totalGrids: componentCount,
      totalConnections: edgeCount,
      avgConnectivity: Number(avgDegree.toFixed(2))
    },
    hubs,
    bridges: [],
    communities: [],
    insights: []
  }
}

function normalizeExecutorResults(rawResults, diagnostics = null) {
  const results = rawResults && typeof rawResults === 'object'
    ? { ...rawResults }
    : {}

  const stats = results.stats && typeof results.stats === 'object'
    ? { ...results.stats }
    : {}

  const graphReasoning = results.graph_reasoning && typeof results.graph_reasoning === 'object'
    ? results.graph_reasoning
    : null

  if (!results.graph_analysis && graphReasoning) {
    results.graph_analysis = buildGraphAnalysisFromReasoning(graphReasoning)
  }

  if (!stats.executor_engine && typeof diagnostics?.engine === 'string' && diagnostics.engine.includes('python')) {
    stats.executor_engine = 'python_grpc'
  }

  return {
    ...results,
    mode: results.mode || 'unknown',
    pois: Array.isArray(results.pois) ? results.pois : [],
    boundary: results.boundary ?? null,
    spatial_clusters: results.spatial_clusters || { hotspots: [] },
    target_regions: Array.isArray(results.target_regions) ? results.target_regions : [],
    region_analyses: Array.isArray(results.region_analyses) ? results.region_analyses : [],
    comparison: results.comparison ?? null,
    vernacular_regions: Array.isArray(results.vernacular_regions) ? results.vernacular_regions : [],
    fuzzy_regions: Array.isArray(results.fuzzy_regions) ? results.fuzzy_regions : [],
    graph_reasoning: graphReasoning,
    stats
  }
}

function normalizeExecutorEnvelope(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      success: false,
      results: normalizeExecutorResults({
        mode: 'empty',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: []
      }),
      error: 'Empty compute payload'
    }
  }

  const envelope = (Object.prototype.hasOwnProperty.call(rawPayload, 'success') && rawPayload.results)
    ? { ...rawPayload }
    : {
        success: true,
        results: rawPayload.results || rawPayload
      }

  const diagnostics = envelope.diagnostics && typeof envelope.diagnostics === 'object'
    ? envelope.diagnostics
    : null

  envelope.results = normalizeExecutorResults(envelope.results, diagnostics)
  return envelope
}


function resolveComputeMode(executorEnvelope, migrationDecision) {
  const computePath = executorEnvelope?._compute_path
  if (computePath === 'python_primary' || computePath === 'node_primary' || computePath === 'node_fallback') {
    return computePath
  }

  return migrationDecision?.use_python_primary ? 'python_primary' : 'node_primary'
}


/**
 */
/**
 * 缂傚倸鍊搁崐椋庣矆娓氣偓瀵敻顢楅埀顒勨€旈崘顔藉癄濠㈠厜鏅滅粙鎾诲箲閸曨垰惟闁挎洍鍋撴い搴㈢洴濮婃椽骞愭惔锝傛闁诲孩鍑归崳锝咁嚕閹剁瓔鏁嗛柛灞剧矌閿涙粌鈹戦悙鏉戠仸闁荤啙鍕珷闂侇剙绉甸悡娑㈡煕閳╁厾顏呮叏瀹ュ鐓?
 * 1) 濠电姷鏁搁崑鐐差焽濞嗘挸瑙﹂悗锝庡枟閺咁亪姊?Python gRPC
 * 2) 闂備浇顕х€涒晠顢欓弽顓炵獥闁哄稁鍘肩壕褰掓煙闂傚鍔嶉柛瀣樀閺屾盯顢曢敐鍡欘槬缂備緡鍋勭粔褰掑箖瑜版帗鎯為柣鐔告緲婵¤櫣绱撴担鎻掍壕闂侀€炲苯澧存慨濠勭帛缁楃喖宕惰缁噣姊?Node executor
 */
function runShadowPythonCompute({ requestId, queryPlan, spatialContext, options, poiFeatures, migrationDecision }) {
  // Shadow run is best-effort and must never break the primary request.
  computeSpatialStream(
    buildGrpcRequest({
      requestId,
      queryPlan,
      spatialContext,
      options: { ...options, mode: 'sync' },
      migrationDecision: { ...migrationDecision, dry_run: true },
      poiFeatures
    }),
    () => Promise.resolve()
  ).catch((err) => {
    console.warn(`[SpatialJobRunner] shadow python compute failed: ${err.message}`)
  })
}

/**
 * Spatial compute strategy:
 * 1) Prefer Python gRPC when migration policy allows
 * 2) Fallback to Node executor when Python compute fails
 * 3) Optional shadow run for dual-run diagnostics
 */
async function computeSpatialWithFallback({
  requestId,
  queryPlan,
  spatialContext,
  options,
  poiFeatures,
  reporter,
  migrationDecision
}) {
  const grpcEnabled = isGrpcComputeEnabled() && options.forceLocalExecutor !== true
  const fallbackReasons = Array.isArray(migrationDecision?.reasons) ? [...migrationDecision.reasons] : []
  if (!grpcEnabled) fallbackReasons.push('grpc_disabled')

  const usePythonPrimary = grpcEnabled && migrationDecision?.use_python_primary === true

  if (usePythonPrimary) {
    try {
      await reporter.reportStage('python_compute', {
        engine: 'grpc',
        endpoint: process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051',
        migration: migrationDecision
      })

      let finalPayload = null
      let attempt = 0
      const maxAttempts = 4
      let lastErr = null

      while (attempt < maxAttempts) {
        attempt += 1
        try {
          await computeSpatialStream(
            buildGrpcRequest({
              requestId,
              queryPlan,
              spatialContext,
              options,
              migrationDecision,
              poiFeatures
            }),
            async (event) => {
              if (event.type === 'STAGE') {
                await reporter.reportStage(event.payload?.stage || 'python_stage', event.payload)
              } else if (event.type === 'PROGRESS') {
                await reporter.reportProgress(event.payload?.progress ?? 0, event.payload)
              } else if (event.type === 'PARTIAL') {
                await reporter.reportPartial(event.payload)
              } else if (event.type === 'FINAL') {
                finalPayload = event.payload
              } else if (event.type === 'ERROR') {
                const streamError = new Error(event.payload?.message || 'Python compute returned ERROR')
                if (event.payload?.code) {
                  streamError.code = String(event.payload.code)
                }
                if (event.payload?.diagnostics && typeof event.payload.diagnostics === 'object') {
                  streamError.diagnostics = event.payload.diagnostics
                }
                throw streamError
              }
            }
          )
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          const errCode = String(err?.code || err?.diagnostics?.error_code || err?.grpc_context?.grpc_status || '')
          if (errCode === '14' && attempt < maxAttempts) {
            console.warn(`[SpatialJobRunner] gRPC unavailable (14). Retrying attempt ${attempt}/${maxAttempts}...`)
            await new Promise((resolve) => setTimeout(resolve, 2000))
            continue
          }
          throw err
        }
      }

      if (lastErr) {
        throw lastErr
      }

      if (finalPayload) {
        const normalizedPython = normalizeExecutorEnvelope(finalPayload)
        return {
          ...normalizedPython,
          _compute_path: 'python_primary',
          _fallback_reasons: fallbackReasons
        }
      }

      throw new Error('Python compute stream ended without FINAL payload')
    } catch (err) {
      const failureDiagnostics = buildFailureDiagnostics({
        error: err,
        traceId: requestId,
        mode: options?.mode || 'sync',
        queryType: queryPlan?.query_type || queryPlan?.queryType || '',
        stagePath: [err?.grpc_context?.last_stage].filter(Boolean),
        spatialContext,
        options,
        grpcContext: err?.grpc_context,
        pythonContext: err?.diagnostics?.python_context || err?.python_context,
        stackPreview: err?.stack
      })

      fallbackReasons.push(`python_error:${failureDiagnostics.error_code || err.message}`)
      await reporter.reportStage('python_fallback_error', {
        reason: err.message,
        error_code: failureDiagnostics.error_code,
        error_signature: failureDiagnostics.error_signature,
        failure_diagnostics: failureDiagnostics
      })

      console.error(
        `[SpatialJobRunner] Python execution failed and Node fallback is disabled: ${failureDiagnostics.error_code || err.message}`
      )

      const wrappedError = new Error(`Spatial compute service unavailable: ${err.message}`)
      wrappedError.code = failureDiagnostics.error_code
      wrappedError.diagnostics = failureDiagnostics
      wrappedError.grpc_context = failureDiagnostics.grpc_context
      throw wrappedError
    }
  }

  if (!usePythonPrimary) {
    console.error('[SpatialJobRunner] Python primary path is required, but migration decision disabled it.')
    throw new Error('Spatial compute requires Python primary path.')
  }

  // Should be unreachable: all paths above either return a result or throw.
  console.error('[SpatialJobRunner] Reached unexpected terminal branch without spatial result.')
  throw new Error('Spatial compute failed: no valid result returned.')
}
// Legacy node executor is intentionally disabled.
/**
 * @deprecated This function is no longer used; Python handles all spatial compute.
 */
async function executeLegacyNodeExecutor(queryPlan, poiFeatures, options, reporter) {
  throw new Error('Legacy Node executor is disabled; Python handles spatial compute.')
}

/**
 * Narrative 濠电姷鏁搁崑娑㈩敋椤撶喐鍙忓Δ锝呭枤閺佸鎲告惔銊ョ疄闁靛ň鏅滈崑鍕煕濠靛嫬鍔楅柡瀣墱缁辨捇宕掑▎鎴濆闂佹寧宀搁弻宥夋煥鐎ｎ偒妫冮梺璇″枦濞夋盯鍩ユ径濞㈢喖宕归鍛磾闂傚倷鐒﹂幃鍫曞磹濠靛洨顩查悹杞拌閸ゆ洘銇勯幇鍫曟闁搞倕顑嗛妵鍕箣閿濆棭妫勬繛?
 * 闂傚倸鍊风粈渚€骞夐敓鐘冲仭妞ゆ牜鍋涢崹鍌炴煟閵忋倖浜ょ紓?sync 闂傚倷娴囧畷鍨叏瀹曞洦濯伴柨鏇炲€搁崹鍌炴煙閹増顥夐柡瀣╃窔濮婃椽顢楅埀顒傜矓閻㈢纾块幖娣妽閸婂灚绻涢幋鐑嗕痪妞ゅ繐鎳庣欢鐐碘偓骞垮劚椤︿即宕戦敐澶嬪€甸柨婵嗙凹缁ㄥ鏌￠崱娆忔灈闁哄备鍓濋幏鍛存濞戞帒浜炬繝闈涱儏閺嬩胶鈧箍鍎卞ú锝呪柦椤忓牊鐓犳繛鏉戭儐濞呭洦淇婇幓鎺旂婵﹥妞藉畷銊︾節閸曨剙娅ч梻浣规偠閸斿酣寮繝姘櫜?worker 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柣銏犳啞閸嬪鏌熼悧鍫熺凡闁搞劌鍊块弻娑樼暆閳ь剟宕戝☉婊呯?
 */
/**
 * Execute a pre-built queryPlan through Python-primary policy with Node fallback.
 * This keeps /api/ai/execute aligned with the migrated runtime path.
 */
export async function executeSpatialPlanWithFallback({
  queryPlan,
  poiFeatures = [],
  spatialContext = {},
  options = {},
  requestId = randomUUID(),
  reporter = {}
} = {}) {
  if (!queryPlan || typeof queryPlan !== 'object') {
    throw new Error('queryPlan is required')
  }

  const report = {
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const migrationDecision = resolveSpatialMigrationDecision({
    requestId,
    queryPlan,
    options
  })

  await report.reportStage('executor', {
    route: migrationDecision.use_python_primary ? 'python_primary' : 'node_primary',
    migration: migrationDecision
  })

  const envelope = await computeSpatialWithFallback({
    requestId,
    queryPlan,
    spatialContext,
    options,
    poiFeatures,
    reporter: report,
    migrationDecision
  })

  const normalized = normalizeExecutorEnvelope(envelope)
  return {
    success: normalized.success !== false,
    results: normalized.results || {},
    diagnostics: {
      compute_mode: resolveComputeMode(normalized, migrationDecision),
      fallback_reasons: normalized?._fallback_reasons || [],
      migration: migrationDecision
    }
  }
}

export async function runNarrativeSpatialJob(payload, reporter = {}) {
  // reporter 闂傚倸鍊烽懗鍫曗€﹂崼銏″床闁割偁鍎辩粈澶愭煙鏉堝墽鐣辩痪鎯ф健閺岀喓绱掗姀鐘崇亪缂備讲鍋撻柛灞绢嚔瑜版帗鏅查柛銉㈡櫆閹叉﹢姊洪崫銉ユ瀻闁硅櫕鍔楀Σ鎰板箳閺傜偓鍕冮梺鍏间航閸庢煡宕曢幘缁樷拺婵懓娲ら埀顒佹礈閳ь剚鐭崡鎶界嵁閸愩劎鏆﹂柛銉ｅ妽濞堟澘顪冮妶鍡樼叆濠⒀傜矙钘濇い鏃傛櫕缁犻箖鏌熼崜褜妫庡瑙勶耿閺屾洟宕堕…鎴犲姺闂佸吋妞芥禍鍫曘€佸Δ浣瑰闁告縿鍎抽悰顔界節濞堝灝鏋熼柨鏇樺灮濞戠數绮欏▎鍓у姺濠殿喗顭堥崺鏍磻閿濆鍊甸柨婵嗙凹缁ㄥ鏌￠崱娆忔灈闁哄备鍓濋幏鍛存濞戞帒浜炬繝闈涙閺嗭箓鏌ｉ幋锝呅撻柛濠勭帛娣囧﹪顢涘┑鍡楁優閻熸粎澧楅悡鈥愁潖?
  const report = {
    reportStage: reporter.reportStage || (async () => {}),
    reportProgress: reporter.reportProgress || (async () => {}),
    reportPartial: reporter.reportPartial || (async () => {}),
    reportText: reporter.reportText || (async () => {})
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const poiFeatures = Array.isArray(payload?.poiFeatures) ? payload.poiFeatures : []
  const spatialContext = payload?.spatialContext || payload?.options?.spatialContext || {}
  const options = payload?.options || {}
  const requestId = payload?.request_id || randomUUID()

  const userQuestion = payload?.query || extractLastUserMessage(messages)
  if (!userQuestion) {
    throw new Error('Missing user question for spatial job')
  }

  const generalQaPresetType = detectGeneralQaPresetType(userQuestion)
  if (generalQaPresetType) {
    const generalQaReason = `preset_${generalQaPresetType}`
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: {
        query_type: 'general_qa',
        intent_mode: 'llm_chat',
        categories: [],
        confidence: {
          score: 9,
          level: 'high',
          reasons: [generalQaReason]
        }
      },
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  const quickPlan = quickIntentClassify(userQuestion)
  if (isGeneralQaQueryPlan(quickPlan)) {
    const generalQaReason = quickPlan?.confidence?.reasons?.[0] || 'general_qa_shortcut'
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: quickPlan,
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  // Greeting-only shortcut to keep chat panel responsive.
  if (isSmallTalkQuestion(userQuestion)) {
    const answer = '\u4f60\u597d\uff01\u6211\u5df2\u5728\u7ebf\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u63d0\u95ee\u7a7a\u95f4\u95ee\u9898\uff0c\u4f8b\u5982\uff1a"\u4e1c\u4fa7\u5496\u5561\u5e97"\u3001"\u8fd9\u7247\u533a\u57df\u9910\u996e\u5206\u5e03"\u3002'

    await report.reportStage('smalltalk')
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'smalltalk' })

    return {
      success: true,
      query_plan: {
        query_type: 'general_qa',
        intent_mode: 'llm_chat',
        confidence: { score: 9, level: 'high', reasons: ['smalltalk_shortcut'] }
      },
      answer,
      results: {
        mode: 'smalltalk',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa'
        }
      },
      diagnostics: {
        engine: 'smalltalk-shortcut',
        request_id: requestId
      }
    }
  }

  const relevance = await classifyGeoRelevance(userQuestion, {
    hasSelectedArea: hasSpatialContext(spatialContext),
    poiCount: poiFeatures.length
  })

  if (!relevance.isGeoRelated) {
    const answer = IRRELEVANT_FRIENDLY_REPLY
    const irrelevantQueryPlan = {
      query_type: 'irrelevant_input',
      intent_mode: 'out_of_scope',
      categories: [],
      confidence: {
        score: relevance.confidence === 'high' ? 9 : relevance.confidence === 'low' ? 5 : 7,
        level: relevance.confidence || 'medium',
        reasons: [
          'query_not_geo_related',
          relevance.source ? `source:${relevance.source}` : null,
          relevance.reason || null
        ].filter(Boolean)
      }
    }

    await report.reportStage('irrelevant_input', {
      reason: relevance.reason || 'query_not_geo_related',
      source: relevance.source || 'rule'
    })
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'irrelevant_input' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: irrelevantQueryPlan,
      answer,
      results: {
        mode: 'irrelevant_input',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'irrelevant_input'
        }
      },
      diagnostics: {
        engine: 'relevance-gate',
        request_id: requestId,
        gate_reason: relevance.reason || 'query_not_geo_related',
        gate_source: relevance.source || 'rule'
      }
    }
  }

  // Stage 1: planner intent parsing
  await report.reportStage('planner', { request_id: requestId })

  let plannerOutput
  let queryPlan

  try {
    plannerOutput = await parseIntent(userQuestion, {
      hasSelectedArea: hasSpatialContext(spatialContext),
      poiCount: poiFeatures.length,
      viewportCenter: getViewportCenter(spatialContext)
    })

    queryPlan = plannerOutput?.queryPlan
  } catch (err) {
    await report.reportStage('planner_fallback', { reason: err.message })
    queryPlan = quickIntentClassify(userQuestion)
  }

  queryPlan = queryPlan || {
    query_type: 'poi_search',
    categories: [],
    radius_m: 1200
  }

  if (isGeneralQaQueryPlan(queryPlan)) {
    const generalQaReason = queryPlan?.confidence?.reasons?.[0] || 'general_qa_from_planner'
    await report.reportStage('general_qa', {
      reason: generalQaReason
    })

    const generalQaResult = await generateGeneralQaAnswer({
      userQuestion,
      messages
    })
    await report.reportText(generalQaResult.text)
    await report.reportProgress(1, { stage: 'completed', mode: 'general_qa' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: queryPlan,
      answer: generalQaResult.text,
      results: {
        mode: 'general_qa',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'general_qa',
          general_qa_source: generalQaResult.source
        }
      },
      diagnostics: {
        engine: 'general-qa-shortcut',
        request_id: requestId,
        general_qa_reason: generalQaReason,
        general_qa_source: generalQaResult.source,
        general_qa_prompt_version: generalQaResult.promptVersion
      }
    }
  }

  if (isIrrelevantQueryPlan(queryPlan)) {
    const answer = IRRELEVANT_FRIENDLY_REPLY

    await report.reportStage('irrelevant_input', {
      reason: queryPlan?.confidence?.reasons?.[0] || 'query_not_geo_related'
    })
    await report.reportText(answer)
    await report.reportProgress(1, { stage: 'completed', mode: 'irrelevant_input' })

    return {
      success: true,
      request_id: requestId,
      query: userQuestion,
      query_plan: queryPlan,
      answer,
      results: {
        mode: 'irrelevant_input',
        pois: [],
        boundary: null,
        spatial_clusters: { hotspots: [] },
        vernacular_regions: [],
        fuzzy_regions: [],
        stats: {
          total_candidates: 0,
          cluster_count: 0,
          query_type: 'irrelevant_input'
        }
      },
      diagnostics: {
        engine: 'relevance-gate',
        request_id: requestId
      }
    }
  }

  const enforced = resolveSourcePolicy(queryPlan, spatialContext, options)
  queryPlan = enforced.queryPlan

  const effectiveOptions = {
    ...options,
    selectedCategories: enforced.policy.selected_categories,
    sourcePolicy: {
      ...(options.sourcePolicy || {}),
      ...enforced.policy
    }
  }

  await report.reportProgress(0.12, {
    stage: 'planner_done',
    query_type: queryPlan.query_type,
    categories: queryPlan.categories || [],
  })

  const shouldUseCache = shouldUseSpatialResultCache(queryPlan, effectiveOptions)
  const spatialCacheFingerprint = shouldUseCache
    ? buildSpatialCacheFingerprint(queryPlan, spatialContext, effectiveOptions, userQuestion)
    : null
  const normalizedQueryType = normalizeQueryType(queryPlan)

  let normalizedExecutor = null
  let migrationDecision = null
  let cacheLock = null
  // Cache lookup path: reuse cached executor envelope when available.
  if (shouldUseCache && spatialCacheFingerprint) {
    const cachedEnvelope = await queryCache.getFromCache(spatialCacheFingerprint, {
      queryType: normalizedQueryType
    })
    if (cachedEnvelope) {
      normalizedExecutor = normalizeExecutorEnvelope(cloneForCache(cachedEnvelope))
      normalizedExecutor.results = normalizedExecutor.results || {}
      normalizedExecutor.results.stats = {
        ...(normalizedExecutor.results.stats || {}),
        cache_hit: true,
        executor_engine: normalizedExecutor.results.stats?.executor_engine || 'cached_spatial_result'
      }

      await report.reportStage('executor_cache_hit', {
        fingerprint: spatialCacheFingerprint.slice(0, 12),
        query_type: normalizeQueryType(queryPlan)
      })
    } else {
      cacheLock = queryCache.acquireComputationLock(spatialCacheFingerprint)
      if (!cacheLock.acquired) {
        await report.reportStage('executor_cache_wait', {
          fingerprint: spatialCacheFingerprint.slice(0, 12),
          query_type: normalizedQueryType
        })

        const lockResolved = await queryCache.waitForComputationLock(spatialCacheFingerprint)
        if (lockResolved) {
          const waitedEnvelope = await queryCache.getFromCache(spatialCacheFingerprint, {
            queryType: normalizedQueryType
          })
          if (waitedEnvelope) {
            normalizedExecutor = normalizeExecutorEnvelope(cloneForCache(waitedEnvelope))
            normalizedExecutor.results = normalizedExecutor.results || {}
            normalizedExecutor.results.stats = {
              ...(normalizedExecutor.results.stats || {}),
              cache_hit: true,
              executor_engine: normalizedExecutor.results.stats?.executor_engine || 'cached_spatial_result_wait'
            }
          }
        }

        if (!normalizedExecutor) {
          const reAcquire = queryCache.acquireComputationLock(spatialCacheFingerprint)
          cacheLock = reAcquire.acquired ? reAcquire : null
        } else {
          cacheLock = null
        }
      }
    }
  }
  // Cache miss path: execute spatial compute and optionally persist cache entry.
  if (!normalizedExecutor) {
    try {
      // Stage 2: spatial execution
      migrationDecision = resolveSpatialMigrationDecision({
        requestId,
        queryPlan,
        options: effectiveOptions
      })

      await report.reportStage('executor', {
        route: migrationDecision.use_python_primary ? 'python_primary' : 'node_primary',
        migration: migrationDecision
      })

      const executorEnvelope = await computeSpatialWithFallback({
        requestId,
        queryPlan,
        spatialContext,
        options: effectiveOptions,
        poiFeatures,
        reporter: report,
        migrationDecision
      })

      normalizedExecutor = normalizeExecutorEnvelope(executorEnvelope)

      if (shouldUseCache && spatialCacheFingerprint && normalizedExecutor.success !== false) {
        await queryCache.setToCache(
          spatialCacheFingerprint,
          cloneForCache(normalizedExecutor),
          normalizedQueryType
        )
      }
    } finally {
      if (cacheLock?.acquired) {
        cacheLock.release()
      }
    }
  }

  await report.reportProgress(0.72, {
    stage: 'executor_done',
    poi_count: Array.isArray(normalizedExecutor?.results?.pois)
      ? normalizedExecutor.results.pois.length
      : 0
  })

  // 闂傚倸鍊搁崐鎼佸磹閹间礁鐤柟鎯版閺勩儵鏌″搴″季闁?3闂傚倸鍊烽悞锔锯偓绗涘懐鐭欓柟鐑橆殕閸嬨倖淇婇悙顒傚矗ter 缂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗ù锝堛€€閸嬫挸顫濋悡搴ｄ桓闁芥鍠庨埞鎴︽偐閸欏鎮欓梺缁樺姇閿曨亪寮婚敐澶婄疀妞ゆ棁濮ゅВ鍕⒑?
  await report.reportStage('writer')

  let answer = ''
  let textBuffer = ''

  const writerRuntimeOptions = {
    ...effectiveOptions,
    onWriterDiagnostics: (diagnostics) => {
      report.reportStage('writer_validation', diagnostics).catch(() => {})
    }
  }

  try {
    for await (const chunk of generateAnswer(userQuestion, normalizedExecutor, writerRuntimeOptions)) {
      answer += chunk
      textBuffer += chunk

      if (textBuffer.length >= 12) {
        await report.reportText(textBuffer)
        textBuffer = ''
      }
    }

    if (textBuffer.length > 0) {
      await report.reportText(textBuffer)
    }
  } catch (err) {
    console.warn(`[SpatialJobRunner] Writer failed, fallback to quick reply: ${err.message}`)
    answer = buildQuickReply(normalizedExecutor)
    await report.reportText(answer)
  }

  if (!String(answer || '').trim()) {
    await report.reportStage('writer_fallback_empty', {
      reason: 'empty_writer_output'
    })
    answer = buildQuickReply(normalizedExecutor)
    await report.reportText(answer)
  }

  await report.reportProgress(1, {
    stage: 'completed'
  })

  const finalResults = normalizedExecutor?.results || {}
  const operatorTimingsMs = finalResults?.stats?.operator_timings_ms
  if (operatorTimingsMs && typeof operatorTimingsMs === 'object') {
    telemetry.recordOperatorTimings(requestId, operatorTimingsMs, {
      query_type: queryPlan?.query_type || 'unknown'
    })
    const rows = Object.entries(operatorTimingsMs).map(([operatorName, totalTimeMs]) => ({
      trace_id: requestId,
      operator_name: operatorName,
      total_time_ms: Number(totalTimeMs || 0),
      query_type: queryPlan?.query_type || 'unknown',
      recorded_at: Date.now()
    }))
    insertOperatorTimingEvents(rows).catch(() => {})
  }

  return {
    success: normalizedExecutor.success !== false,
    request_id: requestId,
    query: userQuestion,
    query_plan: queryPlan,
    answer,
    results: {
      ...finalResults,
      query_executed: queryPlan
    },
    diagnostics: {
      planner: {
        confidence: plannerOutput?.confidence || plannerOutput?.queryPlan?.confidence || null,
        fast_path: plannerOutput?.fastPath || false
      },
      compute_mode: normalizedExecutor?.results?.stats?.cache_hit
        ? 'cache_hit'
        : resolveComputeMode(normalizedExecutor, migrationDecision),
      fallback_reasons: normalizedExecutor?._fallback_reasons || [],
      migration: migrationDecision,
      cache_hit: Boolean(normalizedExecutor?.results?.stats?.cache_hit)
    }
  }
}

/**
 */
/**
 * 闂?Jobs 缂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇炲€哥粻鏉库攽閻樺磭顣查柛?-> 闂?SSE 闂傚倷绀侀幖顐λ囬柆宥呯；婵炴垯鍨归悞鍨亜閹烘垵鈧悂寮告惔锝囩＜濞达絽鎽滅粔娲煛瀹€瀣瘈鐎规洜鍠栭、姗€鎮欓幇鈺佺伈闁哄矉缍佹俊姝岊槻闁宠鐗嗛埞?
 */
export function toLegacySSEPayload(jobResult) {
  const result = jobResult?.results || {}

  return {
    text: jobResult?.answer || '',
    pois: Array.isArray(result.pois) ? result.pois : [],
    boundary: result.boundary || null,
    spatial_clusters: result.spatial_clusters || { hotspots: [] },
    vernacular_regions: Array.isArray(result.vernacular_regions) ? result.vernacular_regions : [],
    fuzzy_regions: Array.isArray(result.fuzzy_regions) ? result.fuzzy_regions : [],
    stats: result.stats && typeof result.stats === 'object' ? result.stats : null
  }
}

export default {
  extractLastUserMessage,
  normalizeVisualModelName,
  decideExecutionMode,
  executeSpatialPlanWithFallback,
  runNarrativeSpatialJob,
  toLegacySSEPayload
}
