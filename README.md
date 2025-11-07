# PocketOption AI Trader

Gemini tabanlı bu Node.js betiği, PocketOption web arayüzünü Puppeteer ile açıp ekran görüntüleri toplar, görselleri Google'ın **gemini-2.5-flash** modeline göndererek kısa vadeli al/sat tahminleri üretir ve sonuçları hem terminalde hem de `planned_actions.jsonl` dosyasında saklar. Araç gerçek işlemleri otomatikleştirmez; yalnızca önerilen aksiyonları kaydeder ve mevcut UI seçicilerinin erişilebilir olduğunu doğrulamak için ilgili düğmelere tıklamayı dener.

> ⚠️ **Uyarı:** Kod örnek amaçlıdır. Gerçek hesaplar üzerinde manuel doğrulama ve risk yönetimi olmadan kullanılmamalıdır.

## Özellikler
- Chromium tarayıcısını görünür modda başlatarak PocketOption hesabına manuel giriş yapmanı sağlar.
- Her döngüde tam sayfa ekran görüntüsü alır ve `screens/` klasörüne `.jpg` olarak kaydeder.
- Görselleri Gemini'ye gönderip yapılandırılmış JSON (fiyat, tahmin, güven skoru, süre, yön) geri alır.
- `confident >= 0.8` eşiğini geçen tahminleri `planned_actions.jsonl` içinde satır bazlı JSON olarak loglar.
- `MAX_CONSEC_ERRORS` (5) hata sonrası sayfayı yenileyerek veya yeni sekme açarak toparlanmayı dener.
- `Ctrl+C` ile temiz çıkış yapar.

## Gereksinimler
- Node.js 18+ (Puppeteer 24 sürümü sebebiyle).
- NPM (veya pnpm/yarn) ile bağımlılık kurulum yetkisi.
- Etkin PocketOption hesabı ve manuel oturum açma olanağı.
- Google AI Studio üzerinden alınmış bir Gemini API anahtarı.

## Kurulum
```bash
git clone <repo-url>
cd PocketOption
npm install
```

## Ortam Değişkenleri
`index.js` dosyası `dotenv/config` yükler ancak `GoogleGenAI` istemcisine ait `apiKey` alanı boş bırakılmıştır. Aşağıdaki gibi bir `.env` dosyası oluşturup anahtarı kodda kullanmalısın:

```env
GOOGLE_API_KEY=ai-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```js
const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
```

Alternatif olarak anahtarı doğrudan dosyaya da yazabilirsin; ancak sürüm kontrolüne eklememeye dikkat et.

## Çalıştırma
```bash
node index.js
```
1. Betik Chromium'u başlatır ve `https://pocketoption.com/en` adresine gider.
2. Konsoldaki geri sayım süresince hesabına **manuel** olarak giriş yap.
3. Giriş tamamlandıktan sonra betik sonsuz döngüye girer:
   - Her ~10 saniyede bir ekran görüntüsü alır.
   - Görseli Gemini'ye yollayıp yanıtı şemaya göre ayrıştırır.
   - Sonuç geçerli ve `confident` değeri ≥ `0.8` ise `planned_actions.jsonl` dosyasına satır ekler ve UI seçicilerinin erişilebilirliğini kontrol etmek için ilgili butona tıklar.
4. Süreci durdurmak için `Ctrl+C` kombinasyonunu kullan.

## Proje Yapısı
- `index.js`: Ana çalışma döngüsü, Gemini çağrısı, ekran görüntüsü alma ve loglama işlemleri.
- `screens/`: Otomatik oluşturulan ekran görüntüleri. `.gitignore` tarafından hariç tutulur.
- `planned_actions.jsonl`: Her satırı ayrı bir tahmin kaydı olan JSON Lines dosyası.
- `.gitignore`: `node_modules/` ve `screens/` klasörlerini dışarıda bırakır.

## Akış Detayları
1. **Hazırlık:** `ensureDir` yardımıyla ekran klasörü oluşturulur, Puppeteer görünür modda açılır.
2. **Screenshot:** `takeScreenshot` fonksiyonu kaliteyi %85'e sabitleyerek `.jpg` üretir.
3. **Gemini Analizi:** `analyzeWithGemini`, görüntüyü base64 olarak okuyup yapılandırılmış cevap döndürür; gelen veri `responseSchema` ile doğrulanır.
4. **Doğrulama:** Yanıtta `result` değeri `BUY/SELL` olmalı ve `confident` 0-1 arasında yer almalıdır. Eşik altındaki tahminler loglanmadan atlanır.
5. **Loglama:** `simulatePlannedAction`, aksiyonu hem konsola yazar hem de `planned_actions.jsonl` dosyasına ekler.
6. **Hata Kurtarma:** 5 ardışık hata sonrasında sayfa yenilenir; gerekirse yeni sekme açılır ve yeniden giriş süresi tanınır.

## Konfigürasyon Sabitleri
| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `LOOP_DELAY_MS` | `10000` | Tahminler arası bekleme süresi. |
| `LOGIN_WAIT_MS` | `25000` | Başlangıçta manuel giriş için verilen süre. |
| `CONFIDENCE_GATE` | `0.8` | Tahmin kabul eşiği. |
| `MAX_CONSEC_ERRORS` | `5` | Yeniden yükleme tetikleyicisi. |
| `SCREEN_DIR` | `./screens` | Ekran görüntülerinin kaydedildiği klasör. |

Bu sabitleri ihtiyaçlarına göre dosya başından güncelleyebilirsin.

## Bilinen Kısıtlar / İyileştirme Alanları
- `apiKey` alanı elle doldurulmalı; `.env` entegrasyonu tamamlanmış değil.
- UI seçicileri PocketOption arayüz değişikliklerinde bozulabilir; düzenli kontrol gerekebilir.
- `simulatePlannedAction` adı "simülasyon" dese de seçiciler bulunduğunda gerçek tıklama yapmaya çalışır. Gerçek fonksiyonellik istenmiyorsa `click()` çağrılarını kaldırmalısın.
- Gelişmiş hata/log yönetimi, metrik toplama veya karar geri bildirimleri henüz bulunmuyor.
- Finansal piyasa verisi sadece ekrandan okunur; websocket/REST tabanlı güvenilir fiyat beslemesi yoktur.

## Sorun Giderme
- **Gemini API hatası:** Yanıtta JSON bulunmuyorsa önce API anahtarının geçerli olduğundan emin ol, sonra `response.text` içeriğini konsolda incele.
- **Puppeteer başlatılamıyor:** Node sürümünü ve Chrome/Chromium bağımlılıklarını kontrol et; Windows'ta antivirüs Puppeteer indirilen dosyalarını engelleyebilir.
- **Giriş aşaması takılıyor:** `LOGIN_WAIT_MS` değerini artırabilir veya oturum açma adımlarını hızlandırabilirsin.
- **Log dosyası büyüyor:** `planned_actions.jsonl` birikimli olduğundan düzenli yedekle/sil.

## Lisans ve Kullanım Notu
Proje dosyalarında lisans belirtilmemiştir; kurumsal veya ticari kullanımdan önce telif sahibinden onay al. Finansal işlemler yüksek risk içerir, aracı sorumluluğu kullanıcıya aittir.

