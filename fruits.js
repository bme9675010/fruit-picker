// 水果資料：names 是給 CLIP 比對用的英文描述，其餘是畫面上顯示的挑選技巧。
// 新增水果後要重新執行 tools/build-embeddings.mjs 產生 embeddings.json。

export const FRUITS = [
  {
    id: 'mango', name: '芒果', emoji: '🥭', season: '5–8 月',
    names: ['a mango', 'mangoes', 'a red and yellow Irwin mango'],
    tips: {
      look: ['果皮飽滿光滑、顏色均勻，愛文以紅中透黃為佳', '表面有一層薄薄白色果粉代表新鮮'],
      touch: ['輕捏微有彈性；太硬還沒熟、太軟就過熟'],
      smell: ['蒂頭附近聞得到濃郁果香'],
      avoid: ['大片黑斑、蒂頭凹陷或流汁'],
      store: ['未熟放常溫催熟，熟了冷藏 2–3 天內吃完'],
    },
  },
  {
    id: 'guava', name: '芭樂', emoji: '🍏', season: '全年',
    names: ['a guava', 'guavas', 'a green guava fruit with bumpy skin'],
    tips: {
      look: ['表皮顆粒（凸起）越明顯越大越甜', '顏色由深綠轉淺綠、微微帶黃且有光澤', '果形圓整、蒂頭周圍飽滿'],
      touch: ['拿起來沉甸甸；喜歡脆口選硬一點的'],
      avoid: ['表皮有黑褐色斑點或碰傷'],
      store: ['裝袋冷藏可放約一週'],
    },
  },
  {
    id: 'wax_apple', name: '蓮霧', emoji: '🔔', season: '12–4 月',
    names: ['a wax apple', 'a java apple', 'glossy red bell-shaped wax apples', 'a pink wax jambu fruit', 'dark red Taiwanese black pearl wax apples'],
    tips: {
      look: ['顏色越深紅越甜（黑珍珠為深紫紅）', '底部（果臍）張開越大越成熟', '表皮有光澤、沒有裂痕'],
      touch: ['拿起來有重量、果實飽滿'],
      avoid: ['果皮裂開、褐斑、底部發黑'],
      store: ['用紙包好冷藏，盡快吃完'],
    },
  },
  {
    id: 'sugar_apple', name: '釋迦', emoji: '🟢', season: '7–3 月',
    names: ['a sugar apple', 'a custard apple', 'an atemoya fruit', 'a green sugar apple with scaly bumps'],
    tips: {
      look: ['鱗目大而飽滿', '鱗目之間的溝由深綠轉淡黃白色表示快熟了'],
      touch: ['買回放常溫，輕壓整顆變軟就可以吃'],
      avoid: ['外皮大面積發黑、裂開出水'],
      store: ['還沒軟之前千萬別冰，會無法後熟；軟了再冷藏 1–2 天'],
    },
  },
  {
    id: 'dragon_fruit', name: '火龍果', emoji: '🐉', season: '6–11 月',
    names: ['a dragon fruit', 'a pitaya', 'a pink dragon fruit with green scales'],
    tips: {
      look: ['果皮鮮紅亮麗、顏色均勻', '鱗片尖端仍是青綠色；鱗片枯黃代表放久了', '果形圓胖飽滿'],
      touch: ['拿起來沉、輕壓微有彈性'],
      avoid: ['表皮皺縮、有軟爛斑'],
      store: ['冷藏約一週'],
    },
  },
  {
    id: 'papaya', name: '木瓜', emoji: '🧡', season: '全年',
    names: ['a papaya', 'papayas', 'a yellow and green papaya fruit'],
    tips: {
      look: ['果皮轉黃超過一半就差不多可以吃', '表皮光滑、果形肥短飽滿'],
      touch: ['輕按略軟有彈性'],
      avoid: ['黑色水漬狀斑點、局部凹陷'],
      store: ['偏綠的放常溫催熟，熟了冷藏'],
    },
  },
  {
    id: 'banana', name: '香蕉', emoji: '🍌', season: '全年',
    names: ['a banana', 'a bunch of bananas', 'ripe yellow bananas'],
    tips: {
      look: ['果皮金黃、出現少許褐色小斑點（芝麻斑）時最香甜', '果柄青綠堅實'],
      avoid: ['果柄發黑或斷裂、果皮大片撞傷'],
      store: ['吊起來放常溫；冷藏會讓果皮變黑'],
    },
  },
  {
    id: 'pineapple', name: '鳳梨', emoji: '🍍', season: '3–8 月',
    names: ['a pineapple', 'pineapples', 'a whole pineapple with a crown of leaves'],
    tips: {
      look: ['果目大而平坦', '底部約 1/3 到一半轉黃', '冠芽（葉子）短小'],
      touch: ['手指彈果身，像彈手臂肉的「肉聲」最好；聲音空洞可能過熟或乾', '同樣大小選較重的'],
      smell: ['底部有淡淡香甜味；有酒味就是過熟'],
      store: ['葉子朝下倒放一天，甜度更平均；切開後冷藏'],
    },
  },
  {
    id: 'watermelon', name: '西瓜', emoji: '🍉', season: '4–8 月',
    names: ['a watermelon', 'a whole watermelon', 'a striped green watermelon'],
    tips: {
      look: ['紋路清楚、間距較寬', '底部著地處的黃斑越黃越熟', '果柄旁捲鬚已乾枯'],
      touch: ['拍打聲音清脆「咚咚」帶回彈；悶聲可能過熟', '同樣大小選較重的'],
      avoid: ['表面凹陷、裂痕'],
      store: ['整顆放陰涼處；切開後包保鮮膜冷藏'],
    },
  },
  {
    id: 'lychee', name: '荔枝', emoji: '🔴', season: '5–7 月',
    names: ['lychees', 'a lychee fruit', 'a bunch of red lychees'],
    tips: {
      look: ['果皮鮮紅、表面龜裂片平坦飽滿', '果蒂新鮮沒有發黑'],
      touch: ['輕捏有彈性'],
      avoid: ['果皮轉褐、有酒味'],
      store: ['連枝裝袋冷藏，盡快吃'],
    },
  },
  {
    id: 'longan', name: '龍眼', emoji: '🟤', season: '7–9 月',
    names: ['longans', 'a bunch of longan fruits', 'clusters of small round tan longan fruits on stems'],
    tips: {
      look: ['果皮黃褐色、表面較光滑', '顆粒大小均勻'],
      touch: ['有彈性、不軟塌'],
      other: ['可以試吃一顆：果肉厚、帶透明感的較甜'],
      avoid: ['果皮發黑潮濕、果梗發霉'],
      store: ['連枝冷藏'],
    },
  },
  {
    id: 'grape', name: '葡萄', emoji: '🍇', season: '6–8 月、11–1 月',
    names: ['grapes', 'a bunch of purple grapes', 'a cluster of grapes'],
    tips: {
      look: ['果粒飽滿、表面有均勻白色果粉', '果梗青綠、顏色深紫均勻'],
      touch: ['拎起輕搖不掉粒'],
      other: ['試吃一串最下面那顆：它最晚熟，它甜整串就甜'],
      store: ['不要洗，直接冷藏；吃前再洗'],
    },
  },
  {
    id: 'strawberry', name: '草莓', emoji: '🍓', season: '12–4 月',
    names: ['a strawberry', 'strawberries', 'a box of red strawberries'],
    tips: {
      look: ['紅色一路紅到蒂頭附近、有光澤', '蒂頭鮮綠微微翹起'],
      smell: ['香氣越濃越好'],
      avoid: ['翻看盒底有沒有壓傷出水或發霉'],
      store: ['不洗、不去蒂冷藏，吃前再洗'],
    },
  },
  {
    id: 'apple', name: '蘋果', emoji: '🍎', season: '全年（進口）',
    names: ['an apple', 'red apples', 'a shiny red apple'],
    tips: {
      look: ['顏色均勻、底部也轉色', '果皮有光澤；部分品種帶透明蜜心'],
      touch: ['拿起有重量、敲起來聲音清脆'],
      avoid: ['表皮皺縮、按下去軟軟的'],
      store: ['冷藏，並與其他水果分開（會加速其他水果熟化）'],
    },
  },
  {
    id: 'citrus', name: '柑橘（柳丁／橘子）', emoji: '🍊', season: '10–3 月',
    names: ['an orange', 'a mandarin orange', 'a ponkan', 'a tangerine', 'citrus fruits with dimpled orange peel'],
    tips: {
      look: ['果皮油胞細密、顏色均勻有光澤', '果蒂新鮮不乾枯'],
      touch: ['拿起來沉代表汁多；柳丁選皮薄緊實，椪柑皮鬆是正常的'],
      avoid: ['果皮乾縮、發軟或有霉點'],
      store: ['通風陰涼處或冷藏'],
    },
  },
  {
    id: 'pomelo', name: '文旦／柚子', emoji: '🟡', season: '8–9 月',
    names: ['a pomelo', 'a pomelo fruit', 'a large green pomelo'],
    tips: {
      look: ['文旦挑「頭尖、肚大、底部寬平」的鐘形', '果皮細緻、油胞細'],
      touch: ['拿起來重、底部按壓有彈性'],
      other: ['買回放幾天「消水」，果皮變軟微皺時更甜'],
      store: ['通風陰涼處'],
    },
  },
  {
    id: 'persimmon', name: '柿子', emoji: '🟠', season: '9–12 月',
    names: ['a persimmon', 'Fuyu persimmons', 'a flat orange persimmon with a green leafy calyx'],
    tips: {
      look: ['果色橙紅均勻、果形端正', '蒂頭完整、緊貼果實'],
      touch: ['甜柿選硬實的；軟柿等全軟再吃'],
      avoid: ['蒂頭和果實之間有縫隙，容易壞'],
      store: ['冷藏'],
    },
  },
  {
    id: 'starfruit', name: '楊桃', emoji: '⭐', season: '9–3 月',
    names: ['a starfruit', 'a carambola', 'a yellow star fruit'],
    tips: {
      look: ['稜角寬厚飽滿、果形大', '顏色由綠轉金黃，稜邊的綠色越少越熟'],
      avoid: ['稜邊發黑褐、有壓傷'],
      store: ['冷藏'],
    },
  },
  {
    id: 'passion_fruit', name: '百香果', emoji: '🟣', season: '6–12 月',
    names: ['a passion fruit', 'purple passion fruits', 'a round dark purple passion fruit'],
    tips: {
      look: ['果皮紫黑；表面微皺代表熟度足、香氣濃'],
      touch: ['拿起來沉甸甸'],
      other: ['果皮光滑的通常偏酸，可放幾天等它微皺'],
      avoid: ['乾癟太嚴重或發霉'],
      store: ['常溫或冷藏'],
    },
  },
  {
    id: 'kiwi', name: '奇異果', emoji: '🥝', season: '全年（進口）',
    names: ['a kiwi fruit', 'kiwifruits', 'a brown fuzzy kiwi fruit'],
    tips: {
      look: ['果形飽滿、絨毛完整'],
      touch: ['輕壓兩端微軟就熟了；太硬的可和蘋果放一起催熟'],
      avoid: ['局部軟爛、凹陷'],
      store: ['熟了再冷藏'],
    },
  },
  {
    id: 'avocado', name: '酪梨', emoji: '🥑', season: '6–12 月',
    names: ['an avocado', 'avocados', 'a green avocado', 'a dark green avocado with bumpy skin'],
    tips: {
      look: ['台灣綠皮酪梨熟了仍是綠的；進口哈斯酪梨熟了會轉深紫黑'],
      touch: ['整顆握著輕壓微軟就可以吃'],
      avoid: ['大面積凹陷、按下去很軟'],
      store: ['未熟放常溫，熟了冷藏 2–3 天'],
    },
  },
  {
    id: 'jujube', name: '蜜棗', emoji: '🫒', season: '12–3 月',
    names: ['an Indian jujube', 'ber fruits', 'a light green Taiwanese jujube', 'smooth green jujube fruits'],
    tips: {
      look: ['果皮由翠綠轉淡綠、帶點黃白光澤', '果皮光滑、果形飽滿'],
      touch: ['硬實清脆'],
      avoid: ['表面有褐斑、皺皮'],
      store: ['裝袋冷藏'],
    },
  },
  {
    id: 'pear', name: '水梨', emoji: '🍐', season: '7–10 月',
    names: ['an Asian pear', 'a nashi pear', 'a round brown Asian pear'],
    tips: {
      look: ['果點細小、表面光滑有光澤', '果形端正、底部凹陷較深'],
      touch: ['硬實、拿起來重'],
      avoid: ['碰傷變色、表皮皺縮'],
      store: ['套袋冷藏'],
    },
  },
  {
    id: 'melon', name: '哈密瓜／洋香瓜', emoji: '🍈', season: '4–11 月',
    names: ['a cantaloupe', 'a muskmelon', 'a netted melon'],
    tips: {
      look: ['網紋細密均勻、明顯凸起', '果柄（T 字蒂）稍微乾'],
      touch: ['底部（花痕處）按壓稍軟有彈性'],
      smell: ['底部聞得到香氣'],
      store: ['未熟放常溫，熟了冷藏'],
    },
  },
  {
    id: 'cherry_tomato', name: '小番茄', emoji: '🍅', season: '12–4 月',
    names: ['cherry tomatoes', 'a bowl of small red cherry tomatoes', 'small oval cherry tomatoes'],
    tips: {
      look: ['顏色紅亮均勻、蒂頭鮮綠'],
      touch: ['硬實飽滿有彈性'],
      avoid: ['裂果、軟爛'],
      store: ['冷藏'],
    },
  },
];

// 非水果的畫面，讓鏡頭沒對準水果時不會硬猜一種水果。
export const BACKGROUNDS = [
  "a photo of a person's face",
  'a photo of a hand',
  'a photo of a room',
  'a photo of a table',
  'a photo of a wall',
  'a photo of the floor',
  'a photo of vegetables',
  'a photo of a smartphone',
  'a photo of text on paper',
  'a blurry photo',
  'a dark photo',
  'a photo of a street',
];

export const TIP_LABELS = {
  look: '👀 看外觀',
  touch: '✋ 摸摸看',
  smell: '👃 聞聞看',
  other: '💡 小技巧',
  avoid: '⚠️ 避開',
  store: '🧊 保存',
};
