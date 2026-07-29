/* ============================================================
   問題データ
   ------------------------------------------------------------
   本番では CSV / スプレッドシートから取り込んだデータが
   ここと同じ形に変換されて入ります（アプリ側の改修は不要）。

   1件の問題 = { id, front, back, explanation, reading? }
     front       : 表示する問題（英単語・熟語・用語）
     back        : 答え（意味）→ 4択の選択肢にも自動で使われます
     explanation : 制作者が書く解説（正解表示と同時に出る）
     reading     : 読み上げ用のテキスト（省略時は front を読む）
   ============================================================ */

const SET_SIZE = 10; // 1セットの問題数（本番想定は50問。デモでは10問）

const SUBJECTS = [
  {
    id: 'english',
    name: '英単語',
    icon: '🔤',
    lang: 'en-US',        // 読み上げの言語
    speakField: 'front',  // 読み上げるのは英単語そのもの
    levels: [
      {
        id: 'en-1',
        name: 'レベル1 中学基礎',
        items: [
          { id: 'en1-01', front: 'ability', back: '能力', explanation: 'able（〜できる）の名詞形。「〜する能力」は ability to do の形で使います。', example: 'She has the ability to solve hard problems.' },
          { id: 'en1-02', front: 'borrow', back: '借りる', explanation: '無料で借りるときは borrow、貸す側は lend。お金を払って借りる場合は rent。', example: 'May I borrow your pen?' },
          { id: 'en1-03', front: 'careful', back: '注意深い', explanation: 'care（注意）+ ful（満ちた）。Be careful! で「気をつけて!」。', example: 'Be careful when you cross the street.' },
          { id: 'en1-04', front: 'decide', back: '決める', explanation: 'decide to do で「〜することに決める」。名詞形は decision。', example: 'We decided to go by bus.' },
          { id: 'en1-05', front: 'enough', back: '十分な', explanation: '発音は「イナフ」。形容詞の後ろに置く点に注意（old enough）。', example: 'I have enough time today.' },
          { id: 'en1-06', front: 'forget', back: '忘れる', explanation: '過去形は forgot、過去分詞は forgotten。反対語は remember。', example: 'Don\'t forget your umbrella.' },
          { id: 'en1-07', front: 'gather', back: '集める', explanation: '人や物が「集まる」という自動詞としても使えます。', example: 'They gathered in the gym.' },
          { id: 'en1-08', front: 'health', back: '健康', explanation: '形容詞は healthy。ea は短く「ヘルス」と読みます。', example: 'Sleep is good for your health.' },
          { id: 'en1-09', front: 'improve', back: '改善する', explanation: '成績や技術が「上達する」という意味でも使います。名詞形は improvement。', example: 'My English improved a lot this year.' },
          { id: 'en1-10', front: 'journey', back: '旅', explanation: '主に陸路の長い旅。trip は短い旅行、travel は移動そのものを指します。', example: 'The journey took three days.' },
          { id: 'en1-11', front: 'kindness', back: '親切', explanation: 'kind（親切な）+ ness（性質）。ness は抽象名詞をつくる頻出の接尾辞です。', example: 'Thank you for your kindness.' },
          { id: 'en1-12', front: 'lend', back: '貸す', explanation: 'lend A B で「AにBを貸す」。借りる側は borrow。', example: 'Can you lend me a pencil?' },
          { id: 'en1-13', front: 'mistake', back: '間違い', explanation: 'make a mistake で「間違える」。by mistake は「うっかり」。', example: 'I made a small mistake.' },
          { id: 'en1-14', front: 'notice', back: '気づく', explanation: '名詞では「掲示・通知」。notice that 〜 で「〜だと気づく」。', example: 'I didn\'t notice the sign.' },
          { id: 'en1-15', front: 'opinion', back: '意見', explanation: 'In my opinion, 〜 で「私の意見では」。英作文でよく使います。', example: 'In my opinion, the movie was great.' },
          { id: 'en1-16', front: 'perhaps', back: 'たぶん', explanation: 'maybe とほぼ同じ意味ですが、perhaps の方がやや硬い表現です。', example: 'Perhaps he is still at school.' },
          { id: 'en1-17', front: 'quiet', back: '静かな', explanation: 'quite（かなり）とつづりが似ているので要注意。', example: 'Please be quiet in the library.' },
          { id: 'en1-18', front: 'reason', back: '理由', explanation: 'the reason why 〜 で「〜する理由」。動詞では「推論する」。', example: 'Tell me the reason for your choice.' },
          { id: 'en1-19', front: 'suddenly', back: '突然', explanation: 'sudden（突然の）+ ly。all of a sudden も同じ意味です。', example: 'Suddenly, it started to rain.' },
          { id: 'en1-20', front: 'through', back: '〜を通って', explanation: '発音は「スルー」。though（けれども）と混同しやすい語です。', example: 'We walked through the park.' },
        ],
      },
      {
        id: 'en-2',
        name: 'レベル2 高校標準',
        items: [
          { id: 'en2-01', front: 'abandon', back: '見捨てる', explanation: '「放棄する」の意味でも頻出。abandon the plan で「計画を断念する」。', example: 'They had to abandon the old plan.' },
          { id: 'en2-02', front: 'benefit', back: '利益', explanation: '動詞では「利益を得る」。benefit from 〜 の形が頻出です。', example: 'Many students benefit from this program.' },
          { id: 'en2-03', front: 'consider', back: '熟考する', explanation: 'consider doing で「〜しようかと考える」。to不定詞は取りません。', example: 'We are considering moving to Tokyo.' },
          { id: 'en2-04', front: 'demand', back: '要求する', explanation: '経済用語では「需要」。supply and demand で「需要と供給」。', example: 'The workers demanded better pay.' },
          { id: 'en2-05', front: 'establish', back: '設立する', explanation: '会社や制度を「確立する」。名詞形は establishment。', example: 'The school was established in 1950.' },
          { id: 'en2-06', front: 'frequent', back: '頻繁な', explanation: '副詞 frequently（しばしば）の形でよく出ます。', example: 'He is a frequent visitor to this city.' },
          { id: 'en2-07', front: 'generate', back: '生み出す', explanation: '電力や利益を「発生させる」。名詞形は generation。', example: 'The dam generates electricity.' },
          { id: 'en2-08', front: 'hesitate', back: 'ためらう', explanation: 'hesitate to do で「〜するのをためらう」。', example: 'Don\'t hesitate to ask questions.' },
          { id: 'en2-09', front: 'indicate', back: '示す', explanation: 'データやグラフが「示している」と述べるときの定番語です。', example: 'The graph indicates a clear increase.' },
          { id: 'en2-10', front: 'maintain', back: '維持する', explanation: '「主張する」の意味もあります。名詞形は maintenance。', example: 'It is hard to maintain this speed.' },
          { id: 'en2-11', front: 'negotiate', back: '交渉する', explanation: '名詞形は negotiation。ビジネス英語の頻出語です。', example: 'They negotiated a new contract.' },
          { id: 'en2-12', front: 'obvious', back: '明らかな', explanation: 'It is obvious that 〜 で「〜は明らかだ」。副詞は obviously。', example: 'It is obvious that he is tired.' },
          { id: 'en2-13', front: 'presume', back: '推定する', explanation: 'assume（仮定する）より根拠のある推定を表します。', example: 'I presume you have already eaten.' },
          { id: 'en2-14', front: 'reduce', back: '減らす', explanation: 're（後ろへ）+ duce（導く）。reduce A to B で「AをBまで減らす」。', example: 'We must reduce plastic waste.' },
          { id: 'en2-15', front: 'significant', back: '重要な', explanation: '「かなりの」という量的な意味もあります。名詞は significance。', example: 'There was a significant change.' },
          { id: 'en2-16', front: 'sufficient', back: '十分な', explanation: 'enough の硬い言い方。反対語は insufficient。', example: 'We have sufficient food for a week.' },
          { id: 'en2-17', front: 'tendency', back: '傾向', explanation: 'have a tendency to do で「〜する傾向がある」。動詞は tend。', example: 'He has a tendency to talk too fast.' },
          { id: 'en2-18', front: 'ultimate', back: '究極の', explanation: '副詞 ultimately は「最終的に」。結論を述べるときに使います。', example: 'Our ultimate goal is world peace.' },
          { id: 'en2-19', front: 'various', back: 'さまざまな', explanation: '名詞形は variety。a variety of 〜 で「さまざまな〜」。', example: 'The shop sells various kinds of tea.' },
          { id: 'en2-20', front: 'withdraw', back: '撤回する', explanation: '「お金を引き出す」意味でも使います。過去形は withdrew。', example: 'She withdrew her application.' },
        ],
      },
    ],
  },

  {
    id: 'kanji',
    name: '漢字・熟語',
    icon: '✍️',
    lang: 'ja-JP',
    speakField: 'reading', // 読み上げるのは「読み」
    levels: [
      {
        id: 'kj-1',
        name: 'レベル1 中学レベル',
        items: [
          { id: 'kj1-01', front: '委ねる', back: 'ゆだねる', reading: 'ゆだねる', explanation: '「任せる」という意味。「判断を委ねる」のように使います。' },
          { id: 'kj1-02', front: '促す', back: 'うながす', reading: 'うながす', explanation: '相手にそうするよう働きかけること。「注意を促す」。' },
          { id: 'kj1-03', front: '朗らか', back: 'ほがらか', reading: 'ほがらか', explanation: '明るく晴れやかな様子。「朗らかな笑顔」。' },
          { id: 'kj1-04', front: '滞る', back: 'とどこおる', reading: 'とどこおる', explanation: '物事が順調に進まないこと。「支払いが滞る」。' },
          { id: 'kj1-05', front: '慌ただしい', back: 'あわただしい', reading: 'あわただしい', explanation: '落ち着かず忙しい様子。「慌ただしい朝」。' },
          { id: 'kj1-06', front: '培う', back: 'つちかう', reading: 'つちかう', explanation: '「土（つち）」から。時間をかけて育てること。「実力を培う」。' },
          { id: 'kj1-07', front: '募る', back: 'つのる', reading: 'つのる', explanation: '「集める」と「ますます強くなる」の二つの意味があります。' },
          { id: 'kj1-08', front: '穏やか', back: 'おだやか', reading: 'おだやか', explanation: '静かで落ち着いている様子。「穏やかな海」。' },
          { id: 'kj1-09', front: '疎か', back: 'おろそか', reading: 'おろそか', explanation: 'いいかげんに扱うこと。「基本を疎かにする」。' },
          { id: 'kj1-10', front: '賄う', back: 'まかなう', reading: 'まかなう', explanation: '費用や食事をやりくりして用意すること。「予算で賄う」。' },
          { id: 'kj1-11', front: '憤る', back: 'いきどおる', reading: 'いきどおる', explanation: '激しく怒ること。名詞は「憤り（いきどおり）」。' },
          { id: 'kj1-12', front: '遮る', back: 'さえぎる', reading: 'さえぎる', explanation: '間に入って止めること。「話を遮る」「日光を遮る」。' },
          { id: 'kj1-13', front: '陥る', back: 'おちいる', reading: 'おちいる', explanation: '悪い状態に入り込むこと。「混乱に陥る」。' },
          { id: 'kj1-14', front: '滑らか', back: 'なめらか', reading: 'なめらか', explanation: '「滑」は「すべる」とも読みます。「滑らかな動き」。' },
          { id: 'kj1-15', front: '偏る', back: 'かたよる', reading: 'かたよる', explanation: '一方に寄ること。「栄養が偏る」。名詞は「偏り」。' },
          { id: 'kj1-16', front: '欺く', back: 'あざむく', reading: 'あざむく', explanation: 'だますこと。「人を欺く」。「詐欺（さぎ）」の欺と同じ字。' },
          { id: 'kj1-17', front: '緩やか', back: 'ゆるやか', reading: 'ゆるやか', explanation: '傾きや変化がゆっくりな様子。「緩やかな坂」。' },
          { id: 'kj1-18', front: '諮る', back: 'はかる', reading: 'はかる', explanation: '相談すること。「審議会に諮る」。同音の「図る・計る」と区別。' },
          { id: 'kj1-19', front: '拒む', back: 'こばむ', reading: 'こばむ', explanation: '断ること。「要求を拒む」。「拒否」の拒と同じ字。' },
          { id: 'kj1-20', front: '潤う', back: 'うるおう', reading: 'うるおう', explanation: '水分を含むこと。転じて「生活が豊かになる」の意味も。' },
        ],
      },
    ],
  },

  {
    id: 'history',
    name: '日本史',
    icon: '🏯',
    lang: 'ja-JP',
    speakField: 'reading',
    levels: [
      {
        id: 'hs-1',
        name: 'レベル1 中世〜近世',
        items: [
          { id: 'hs1-01', front: '御成敗式目', back: '1232年に北条泰時が定めた武家法', reading: 'ごせいばいしきもく', explanation: '武士の慣習をまとめた初の武家法典。貞永式目とも呼ばれます。' },
          { id: 'hs1-02', front: '応仁の乱', back: '1467年に始まった京都の大乱', reading: 'おうにんのらん', explanation: '将軍の後継争いが発端。以後、戦国時代へと移ります。' },
          { id: 'hs1-03', front: '楽市・楽座', back: '織田信長らが行った商業自由化策', reading: 'らくいちらくざ', explanation: '座の特権を廃し、誰でも自由に商売できるようにした政策。' },
          { id: 'hs1-04', front: '太閤検地', back: '豊臣秀吉が行った全国的な土地調査', reading: 'たいこうけんち', explanation: 'ものさしと枡を統一し、石高で年貢を定めました。' },
          { id: 'hs1-05', front: '刀狩令', back: '1588年に農民の武器を没収した法令', reading: 'かたながりれい', explanation: '秀吉が発令。太閤検地と合わせて兵農分離を進めました。' },
          { id: 'hs1-06', front: '武家諸法度', back: '江戸幕府が大名を統制した法令', reading: 'ぶけしょはっと', explanation: '1615年に最初に発布。参勤交代は3代家光の時に加えられました。' },
          { id: 'hs1-07', front: '参勤交代', back: '大名が江戸と領地を往復した制度', reading: 'さんきんこうたい', explanation: '往復の費用が大名の財政を圧迫し、幕府への反抗を抑えました。' },
          { id: 'hs1-08', front: '鎖国', back: '江戸幕府の対外交流制限政策', reading: 'さこく', explanation: '完全な閉鎖ではなく、長崎・対馬・薩摩・松前の四つの窓口がありました。' },
          { id: 'hs1-09', front: '享保の改革', back: '8代将軍徳川吉宗による幕政改革', reading: 'きょうほうのかいかく', explanation: '目安箱の設置、公事方御定書の制定などを行いました。' },
          { id: 'hs1-10', front: '寛政の改革', back: '松平定信による幕政改革', reading: 'かんせいのかいかく', explanation: '囲米や棄捐令を実施。厳しすぎて短期間で終わりました。' },
          { id: 'hs1-11', front: '天保の改革', back: '水野忠邦による幕政改革', reading: 'てんぽうのかいかく', explanation: '株仲間の解散や人返し令を実施。江戸三大改革の最後です。' },
          { id: 'hs1-12', front: '日米和親条約', back: '1854年にペリーと結んだ条約', reading: 'にちべいわしんじょうやく', explanation: '下田・箱館の2港を開港し、鎖国が終わりました。' },
          { id: 'hs1-13', front: '安政の大獄', back: '井伊直弼による反対派の弾圧', reading: 'あんせいのたいごく', explanation: '吉田松陰らが処罰され、桜田門外の変につながりました。' },
          { id: 'hs1-14', front: '大政奉還', back: '1867年に将軍が政権を朝廷へ返上', reading: 'たいせいほうかん', explanation: '15代将軍徳川慶喜が実施。江戸幕府はここで終わります。' },
          { id: 'hs1-15', front: '版籍奉還', back: '1869年に大名が土地と人民を返上', reading: 'はんせきほうかん', explanation: '「版」は土地、「籍」は人民。廃藩置県の前段階です。' },
          { id: 'hs1-16', front: '廃藩置県', back: '1871年に藩を廃止し県を置いた改革', reading: 'はいはんちけん', explanation: '中央から県令を派遣し、中央集権体制が確立しました。' },
          { id: 'hs1-17', front: '地租改正', back: '1873年に始まった税制改革', reading: 'ちそかいせい', explanation: '地価の3%を現金で納める方式に変更。財政が安定しました。' },
          { id: 'hs1-18', front: '殖産興業', back: '明治政府の産業育成政策', reading: 'しょくさんこうぎょう', explanation: '富岡製糸場などの官営模範工場を設立しました。' },
          { id: 'hs1-19', front: '自由民権運動', back: '国会開設などを求めた政治運動', reading: 'じゆうみんけんうんどう', explanation: '板垣退助の民撰議院設立建白書が出発点です。' },
          { id: 'hs1-20', front: '大日本帝国憲法', back: '1889年発布の欽定憲法', reading: 'だいにほんていこくけんぽう', explanation: '伊藤博文が中心となり、ドイツ憲法を参考に作られました。' },
        ],
      },
    ],
  },
];
