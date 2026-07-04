# ECGFounder 婕旂ず鍚姩妫€鏌ユ竻鍗?

杩欎唤娓呭崟鐢ㄤ簬绛旇京鎴栨紨绀哄満鏅紝纭繚鍓嶇銆佹ā鎷熺梾渚嬫帴鍙ｃ€丒CGFounder Sidecar銆佽缁冭皟搴﹀櫒鍜屽弬鏁拌瀵熷櫒鐨勮繘绋嬪綊灞炴竻鏅般€?

## 绔彛

- 鍓嶇锛歚http://localhost:3000/`
- 妯℃嫙鐥呬緥鎺ュ彛锛歚http://localhost:4000/api/health`
- ECGFounder Sidecar锛歚http://localhost:6090/health`

## 鍚姩椤哄簭

1. 鍦ㄥ墠绔」鐩牴鐩綍鍚姩鍓嶇鍜屾ā鎷熺梾渚嬫帴鍙ｏ細

   ```bash
   npm start
   ```

   璇ュ懡浠よ礋璐ｇ鍙?`3000` 鍜?`4000`銆?

2. 鍚姩 ECGFounder 骞冲彴杩涚▼锛?

   ```bat
   proxy-server\run_platform.bat
   ```

   璇ヨ剼鏈礋璐ｅ惎鍔?`6090` Sidecar锛屼互鍙?`finetune_runner.py` 鍜?`param_observer.py`銆?

3. 杩愯婕旂ず棰勬锛?

   ```bash
   npm run preflight:demo -- --live
   ```

   濡傛灉婕旂ず闇€瑕佺幇鍦烘彁浜よ缁冧换鍔℃垨灞曠ず瀹炴椂鍙傛暟缁熻锛岃浣跨敤 `--live`銆備笉鍔?`--live` 鏃讹紝璁粌璋冨害鍣ㄥ拰鍙傛暟瑙傚療鍣ㄦ湭杩愯鍙細鏄剧ず涓鸿鍛娿€?

## 閲嶅鐩戝惉娓呯悊

鎵撳紑婕旂ず椤甸潰鍓嶅厛杩愯锛?

```bash
npm run preflight:demo
```

濡傛灉鏌愪釜绔彛鏄剧ず澶氫釜鐩戝惉 PID锛屾紨绀哄墠搴斿厛鍋滄閲嶅杩涚▼銆傛渶甯歌鐨勯棶棰樻槸涔嬪墠杩愯 `npm start` 鍚庢畫鐣欎簡鏃х殑 `4000` 妯℃嫙鎺ュ彛杩涚▼銆?

鍦ㄥ彈闄?Windows shell 涓紝绔彛鎴栬繘绋嬫鏌ュ彲鑳借繑鍥?`spawn EPERM`銆傝繖绉嶆儏鍐典笅锛岄妫€浠嶄細楠岃瘉 HTTP 绔偣锛屽苟鎶婅绯荤粺鎷掔粷鐨?PID 妫€鏌ユ樉绀轰负璀﹀憡銆傚鏋滈渶瑕佺簿纭殑 PID 娓呯悊淇℃伅锛岃鍦ㄦ櫘閫?Windows 缁堢涓噸鏂拌繍琛屽悓涓€鏉″懡浠ゃ€?

濡傛灉 `finetune_runner.py` 鎴?`param_observer.py` 宸茬粡杩愯锛屼絾 `6090` 涓嶉€氾紝閬垮厤閲嶅鍚姩 runner/observer銆傚彧鍚姩 Sidecar锛?

```bash
cd proxy-server
python -m uvicorn main:app --host 0.0.0.0 --port 6090
```

## 棰勬湡缁撴灉

涓€涓彲鐢ㄤ簬瀹炴椂璁粌婕旂ず鐨勭幆澧冨簲婊¤冻锛?

- 鍓嶇 `3000` 鍙闂?
- 妯℃嫙鐥呬緥鎺ュ彛 `4000` 鍙闂?
- Sidecar `6090` 鍙闂?
- 姣忎釜绔彛鍙湁涓€涓洃鍚繘绋?
- `finetune_runner.py` 姝ｅ湪杩愯
- `param_observer.py` 姝ｅ湪杩愯

濡傛灉鍙仛鍘嗗彶缁撴灉婕旂ず锛屽彲浠ュ拷鐣?runner 鍜?observer 鐨勮鍛婏紝浣?`3000`銆乣4000`銆乣6090` 浠嶅簲鍙闂€?

## Demo / 闈炰复搴婅竟鐣屾彁绀?

婕旂ず鐜涓粯璁や笉鎸傜湡瀹?TF.js 妯″瀷锛坄public/models/ecg-classifier/` 鍙斁缃鏄庯紝涓嶆斁 `model.json`锛夛紝涔熶笉杩炵湡瀹?PTB-XL / CPSC2018 鏁版嵁銆傚惎鍔ㄥ悗璇峰悜璇勫/绛旇京瑙備紬鏄庣‘浠ヤ笅瑙嗚鎻愮ず浼氭寔缁瓨鍦細

- 椤甸潰椤堕儴榛勮壊 **"Demo / Research Preview 鈥?Not a Medical Device"** 妯箙锛坄src/components/DemoBanner.tsx`锛屼笉鍙叧闂級銆?
- 渚ф爮 `Demo / Mock` 妯″紡 tag銆?
- `AI Models` 椤垫瘡鏉¤褰曟梺鐨勬鑹?`MOCK` chip銆?
- `Annotation Studio` AI 璇婃柇缁撴灉鍗＄墖鍙充晶鐨勬鑹?`MOCK` chip锛堟潵鑷?`modelService.isUsingMockInference()`锛屽湪鍔犺浇/鍒嗘瀽闃舵閮戒細鎸佷箙鏄剧ず锛?0 绉掑悗涓嶄細娑堝け锛夈€?
- 瀵煎嚭 JSON / CSV 鐨?`diagnosis.source` 瀛楁鍊间负 `mock` 鎴?`unavailable`锛屼笅娓告秷璐硅€呭彲鎹鍖哄垎鐪熷疄 TF.js 鎺ㄧ悊涓庡惎鍙戝紡 fallback銆?

濡傛灉璇勫鐜板満闇€瑕佹紨绀虹湡瀹炴ā鍨嬫帹鐞嗭紝璇峰厛鎶?`model.json` + 鏉冮噸 shard 鏀惧叆 `public/models/ecg-classifier/`锛岄噸鏂?`npm run build`锛岀劧鍚庡啀鍔犺浇妯″瀷锛涘闇€绂荤嚎鎺ㄧ悊璇佹槑锛岃淇濈暀 `modelService` 鐨?IndexedDB 缂撳瓨璺緞锛坄indexeddb://ecg-model-cache-*`锛夈€傛洿澶氬鏍歌褰曡 `docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md`銆?
