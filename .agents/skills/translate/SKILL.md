---
name: translate
description: Thêm, sửa hoặc rà soát chuỗi giao diện trong src/data/i18n/vi.json, en.json và ja.json của Lancity. Dùng mỗi khi đụng tới các file này hoặc thêm khóa dịch mới. Quy định ngôn ngữ nguồn, thuật ngữ không dịch, giọng văn tiếng Việt, ICU plural, giữ placeholder và cách kiểm tra đồng bộ.
user_invocable: true
---

# Translate (Lancity i18n)

Quy tắc dịch chuỗi giao diện của Lancity. Đọc trước khi sửa `src/data/i18n/vi.json`, `en.json` hoặc `ja.json`.

## Cấu trúc hiện tại

| Thành phần | Vị trí | Ghi chú |
| --- | --- | --- |
| Chuỗi tiếng Việt | `src/data/i18n/vi.json` | **Nguồn chuẩn.** `Messages = typeof vi.json` trong `src/types/i18n/schema.ts`, nên khóa trong `vi.json` quyết định kiểu của `t()` |
| Chuỗi tiếng Anh | `src/data/i18n/en.json` | Phải có đúng bộ khóa của `vi.json` |
| Chuỗi tiếng Nhật | `src/data/i18n/ja.json` | Phải có đúng bộ khóa và thứ tự của `vi.json` |
| Chuỗi luồng xác thực mở rộng | `src/components/auth/auth-messages.ts` | Nguồn chuỗi thứ hai, có đủ `en`, `vi`, `ja`. Component chọn bằng `authMessages[locale]` |
| Locale, cookie, `resolveLocale`, `getErrorMessage` | `src/data/i18n/config.ts` | Dùng được ở cả client và server |
| Nạp messages theo cookie | `src/i18n/request.ts` | Chỉ chạy ở server, do `next-intl` yêu cầu đúng đường dẫn này |
| Kiểu `Locale`, `Messages`, `MessageError` | `src/types/i18n/schema.ts` | Theo quy ước `AGENTS.md`, kiểu để trong `src/types/<domain>/` |
| Khai báo kiểu cho `next-intl` | `src/types/i18n/next-intl.d.ts` | Không sửa khi chỉ thêm khóa |
| Chuỗi editor | nhóm `editor` | Component dùng `useEditorTranslations()`. Mã chạy ngoài React (plugin, extension, hằng số) dùng `translateEditor()` từ `src/components/editor/i18n.ts`. Lỗi kỹ thuật trong `console.*` và `throw new Error` giữ tiếng Anh. Tên icon Lucide là khóa lưu trữ, không dịch |

Có ba ngôn ngữ: `vi`, `en`, `ja`. Mỗi ngôn ngữ là **một file JSON phẳng theo nhóm** (`auth`, `errors`, ...), không chia theo namespace. Không có script `sync-check`. Việc kiểm tra đồng bộ do TypeScript đảm nhiệm, xem phần [Kiểm tra](#kiểm-tra).

Ngôn ngữ mặc định là `vi` (`defaultLocale` trong `config.ts`). Locale giá trị lạ hoặc thiếu cookie đều rơi về `vi`.

## Quy tắc bắt buộc

1. **Mọi khóa phải có ở cả `vi.json`, `en.json` và `ja.json`, trong cùng một thay đổi.** Không chép chuỗi ngôn ngữ này sang file ngôn ngữ khác để "dịch sau". Người dùng sẽ thấy sai ngôn ngữ mà không có lỗi nào báo.
2. **Không đổi tên khóa đang được tham chiếu bằng chuỗi động.** Các khóa trong `errors` được tra bằng mã lỗi do server hoặc Better Auth trả về, qua `getErrorMessage(t, key)`. Khóa không tồn tại sẽ rơi về `errors.invalidForm`. Đổi tên một khóa `errors.*` mà không đổi mã lỗi tương ứng sẽ làm mất thông báo cụ thể mà không báo lỗi biên dịch. Tìm bằng `grep` mã lỗi ở `src/lib/auth/`, `src/server/` và `src/types/` trước khi đổi.
3. **Giữ nguyên placeholder, thẻ và cú pháp ICU** (xem bên dưới).
4. **Không dịch tên thương hiệu và thuật ngữ kỹ thuật** (xem Thuật ngữ).

## Thuật ngữ

### Không dịch (giữ nguyên ở mọi ngôn ngữ)

- **Lancity** (tên sản phẩm).
- Tên dịch vụ bên thứ ba: **Google**, GitHub, Slack, Cloudflare, v.v.
- Từ viết tắt và mã: API, OAuth, SSO, URL, ID, JSON, CSV, PDF, HTTP(S).
- Tên phím: `Ctrl`, `Cmd`, `Shift`, `Alt`, `Enter`, `Esc`, `Tab`.
- Biến và thẻ trong chuỗi (xem phần Placeholder).

### Từ điển thuật ngữ của Lancity

Chỉ ghi các thuật ngữ đã dùng trong giao diện. Khi xuất hiện thuật ngữ mới, thêm một dòng vào bảng này **trong cùng thay đổi** để lần sau không dịch khác đi.

| Tiếng Anh | Tiếng Việt | Tiếng Nhật | Ghi chú |
| --- | --- | --- | --- |
| Workspace | Không gian làm việc | ワークスペース | Không viết "workspace" hay "không gian" trơ trọi |
| Account | Tài khoản | アカウント | |
| Sign in | Đăng nhập | ログイン | Nhật dùng ログイン, không dùng サインイン, để đi cùng ログアウト |
| Sign out | Đăng xuất | ログアウト | Plane dùng サインアウト. Lancity dùng ログアウト để cặp với ログイン |
| Create an account | Đăng ký | アカウントを作成 | Nhãn nút/liên kết tiếng Việt là "Đăng ký" |
| Display name | Tên hiển thị | 表示名 | |
| Username | Tên đăng nhập | ユーザー名 | Không dùng "tên người dùng" |
| Email | Email | メールアドレス | Nhật không dùng メール đơn lẻ cho nhãn ô nhập |
| Password | Mật khẩu | パスワード | |
| Link (an account) | Liên kết | 連携 | Unlink: 連携を解除. Dùng cho liên kết tài khoản Google, không dùng リンク (nghĩa là hyperlink) |
| Link (hyperlink) | Liên kết | リンク | Trong editor. Remove link: Xóa liên kết / リンクを削除 |
| Editor | Trình soạn thảo | エディター | |
| Page | Trang | ページ | Trang tài liệu của project, như Plane |
| Work item | Công việc | 作業項目 | Lancity gọi bảng và API là `issue`. Plane vi dùng "Mục công việc", Lancity chọn "Công việc" cho ngắn. Nhật theo Plane |
| Heading | Tiêu đề | 見出し | "Tiêu đề 1" như Google Docs. Nhật viết liền số: 見出し1 |
| Untitled (page title) | Chưa có tiêu đề | 無題 | Placeholder ô tiêu đề trang |
| Block | Khối | ブロック | Đoạn, danh sách, bảng… trong editor |
| Callout | Khung chú thích | コールアウト | |
| Mention | Nhắc đến | メンション | Chưa có nhãn riêng. Dùng khi thêm chuỗi về mention |
| Embed | Nhúng | 埋め込み | "Nhúng một công việc" |
| Duplicate | Nhân bản | 複製 | Chép tài nguyên (ảnh) khi nhân bản dùng "sao chép" / コピー |
| Upload | Tải lên | アップロード | Download: Tải xuống / ダウンロード |
| Emoji | Emoji | 絵文字 | |

Các thực thể nghiệp vụ như Project, Cycle, Module chưa có chuỗi giao diện. Khi cần dịch lần đầu, chọn một cách dịch, ghi vào bảng trên, rồi dùng nhất quán. Tránh tự đặt từ hiếm. Nếu tiếng Việt đã quen dùng từ gốc (ví dụ "Issue"), có thể giữ nguyên và ghi rõ quyết định đó vào bảng.

Một khái niệm chỉ dùng một cách gọi. Không đổi qua lại giữa "đăng ký" và "tạo tài khoản", hay "đăng nhập" và "đăng nhập vào" trong cùng luồng.

## Giọng văn

### Tiếng Việt (`vi`)

- Xưng hô trung tính. Thông báo hệ thống không cần đại từ ("Mật khẩu cần có ít nhất 8 ký tự."). Khi cần gọi người dùng, dùng **bạn**. Không dùng "mày", "anh/chị", "quý khách".
- Lời đề nghị thử lại dùng **"Vui lòng thử lại."** như các chuỗi hiện có trong `errors`.
- **Dấu tiếng Việt là bắt buộc.** Không bỏ dấu, không dùng kiểu gõ Telex còn sót (`ddawng nhaapj`).
- Viết hoa theo kiểu câu: chỉ viết hoa chữ đầu câu và tên riêng. "Tên hiển thị", không phải "Tên Hiển Thị".
- Câu thông báo kết thúc bằng dấu chấm. Nhãn nút, tiêu đề và nhãn ô nhập không có dấu chấm.
- Khoảng giá trị dùng dấu gạch ngang en (`3–30`), như chuỗi `invalidUsername` hiện có.
- Dùng dấu nháy thẳng `"…"`. Dấu chấm câu theo quy tắc tiếng Việt (không có khoảng trắng trước `.,;:?!`).
- Không dùng emoji, tiếng lóng, thành ngữ, hay dấu chấm than (trừ khi chúc mừng một mốc thật sự).

### Tiếng Anh (`en`)

- Sentence case cho nút, tiêu đề, tooltip ("Create an account", không phải "Create An Account").
- Giọng chủ động, thì hiện tại. Ví dụ: "Check the information you entered and try again."
- Thông báo lỗi nói rõ cách khắc phục, không đổ lỗi cho người dùng.
- Dùng "Lancity" nguyên văn ("New to Lancity?").

### Tiếng Nhật (`ja`)

Tham chiếu: bản dịch `ja` của plane-demo (`cortex-town/plane-demo/packages/i18n/src/locales/ja/`). Dùng lại từ vựng của Plane khi nghĩa trùng, trừ các điểm đã ghi trong bảng thuật ngữ.

- **Thể lịch sự です・ます.** Không dùng thể thường (だ・である). Thông báo kết thúc bằng 「〜してください。」「〜できませんでした。」「もう一度お試しください。」. Không dùng 尊敬語 và 謙譲語 nặng nề.
- **Dấu câu toàn chiều rộng:** `。、！？（）`. Không có khoảng trắng quanh chúng. Câu thông báo kết thúc bằng `。`, nhãn nút, tiêu đề và nhãn ô nhập không có dấu chấm. Câu hỏi dùng `？` (ví dụ 「すでにアカウントをお持ちですか？」).
- **Khoảng giá trị** dùng `〜` (3〜30文字), không dùng gạch ngang en.
- **Dấu ngoặc kép** dùng 「」, lồng nhau dùng 『』.
- **Katakana kéo dài âm** theo kiểu Microsoft: ユーザー, サーバー, エディター.
- **Không chèn khoảng trắng** giữa tiếng Nhật và chữ Latin hay số (`Googleでログイン`, `8文字以上`, `Lancityは初めてですか？`). Khác với tiếng Trung, tiếng Nhật không cần khoảng trắng này.
- **Tên thương hiệu giữ Latin** (`Lancity`, `Google`). Không viết katakana `ランシティ`.
- **Cấu trúc câu có biến:** động từ đứng cuối, nên không ghép mảnh chuỗi. Dùng một chuỗi hoàn chỉnh với `{provider}` (`{provider}で続行`) thay vì nối "Continue with" và tên dịch vụ trong mã.
- **Đồng nhất cặp từ:** ログイン đi với ログアウト, dù Plane trộn サインイン/サインアウト.
- **Tên phím hoặc ký tự lệnh** trong câu đặt trong 「」: 「/」でコマンドを表示….
- **Phông chữ:** `Be Vietnam Pro` không có chữ Nhật. `--font-sans` trong `src/app/globals.css` có dự phòng `Hiragino Sans`, `Yu Gothic`, `Noto Sans JP`. Nếu thêm phông web cho tiếng Nhật, đặt nó vào chuỗi này, không đổi `font-sans` của các ngôn ngữ khác.

### Độ dài

Tiếng Việt thường dài hơn tiếng Anh khoảng 10–30% ở nhãn ngắn. Tiếng Nhật ngắn hơn về số ký tự nhưng câu thông báo lịch sự có thể dài hơn tiếng Anh. Giao diện phải chịu được mức này mà không cắt chữ. Nếu một chuỗi nằm trong nút hoặc ô có độ rộng cố định, kiểm tra cả ba ngôn ngữ trên viewport hẹp.

## Placeholder, ICU và thẻ

Với mỗi chuỗi, kiểm tra trước khi lưu:

- [ ] Cùng tập biến `{name}`, `{count}` ở mọi ngôn ngữ, giống từng ký tự (`{userName}` khác `{username}`).
- [ ] Cùng thẻ rich-text `<b>…</b>`, `<link>…</link>` với cùng tên thẻ và cùng thứ tự lồng nhau. Chỉ dịch chữ bên trong.
- [ ] Từ khóa ICU (`plural`, `select`, `one`, `other`, `=0`, `#`) giữ nguyên.
- [ ] Không thêm hoặc bớt ý so với bản gốc.

Biến có thể đổi vị trí cho đúng ngữ pháp:

```
vi: "Chào {name}, bạn có {count} thông báo mới."
en: "Hi {name}, you have {count} new notifications."
```

Không viết cứng định dạng ngày hoặc số vào chuỗi. Dùng ICU để `next-intl` tự định dạng theo locale:

```json
"updatedOn": "Cập nhật {date, date, medium}",
"progress": "Hoàn thành {ratio, number, percent}"
```

`timeZone` được đặt cố định là `UTC` trong `src/i18n/request.ts`. Khi hiển thị giờ cho người dùng, cần quyết định riêng về múi giờ, đừng sửa chuỗi để bù.

### Số nhiều (CLDR)

| Locale | Từ khóa bắt buộc |
| --- | --- |
| `en` | `one`, `other` |
| `vi` | `other` |
| `ja` | `other` |

Tiếng Việt và tiếng Nhật không chia số ít/số nhiều, chỉ cần `other`. Không thêm `one` trong `vi.json` và `ja.json`.

```json
// en.json
"memberCount": "{count, plural, one {# member} other {# members}}"
// vi.json
"memberCount": "{count, plural, other {# thành viên}}"
// ja.json
"memberCount": "{count, plural, other {#人のメンバー}}"
```

Chuỗi `en` luôn phải có `other` để làm dự phòng đầy đủ nghĩa.

## Quy trình

### Thêm khóa mới

1. Thêm vào `vi.json` trước, đặt trong nhóm phù hợp (`auth`, `errors`, hoặc nhóm mới theo tính năng). Tên khóa viết camelCase, mô tả ý nghĩa chứ không chép nguyên câu (`invalidEmail`, không phải `emailKhongHopLe`).
2. Thêm cùng khóa, cùng vị trí vào `en.json` và `ja.json`.
3. Dùng trong component: `useTranslations()` (hoặc `useTranslations('errors')`) ở client, `await getTranslations()` ở server.
4. Chạy [kiểm tra](#kiểm-tra).

Thêm nhóm mới: thêm vào cả ba file với cùng tên nhóm và cùng thứ tự khóa. Không cần đăng ký namespace nào khác.

### Đổi nội dung một chuỗi

Khi nghĩa thay đổi, sửa cả ba ngôn ngữ trong cùng thay đổi. Chỉ sửa lỗi chính tả của một ngôn ngữ thì không cần đụng ngôn ngữ kia.

### Xóa khóa

Xóa ở cả ba file. Trước khi xóa, `grep` tên khóa trong `src/`, đặc biệt với `errors.*` (có thể được tra bằng chuỗi động, xem Quy tắc 2).

### Thêm ngôn ngữ mới

Làm theo đúng cách đã thêm `ja`:

1. Thêm mã vào `Locale` trong `src/types/i18n/schema.ts`.
2. Tạo `src/data/i18n/<mã>.json` với đúng bộ khóa và thứ tự của `vi.json`.
3. Thêm vào `languages` và sửa `resolveLocale` trong `src/data/i18n/config.ts`. Hàm này chỉ nhận các mã được liệt kê, mã lạ rơi về `vi`.
4. Thêm vào `dictionaries` trong `src/i18n/request.ts`.
5. Thêm khối ngôn ngữ vào `authMessages` trong `src/components/auth/auth-messages.ts`. Kiểu `as const` cùng `authMessages[locale]` làm typecheck báo lỗi nếu thiếu.
6. `language-switch.tsx` dựng nút từ `languages`, không cần sửa.
7. Kiểm tra phông chữ có đủ glyph cho chữ viết mới (xem `--font-sans` trong `src/app/globals.css`).
8. Bổ sung vào skill này: từ khóa plural (tra bảng CLDR), dấu câu, đại từ xưng hô và mức độ trang trọng cho B2B SaaS, mức giãn nở độ dài, và cột mới trong từ điển thuật ngữ.

## Kiểm tra

Không có script đồng bộ riêng. `src/i18n/request.ts` khai báo `dictionaries: Record<Locale, Messages> = { en, ja, vi }`, nên `en.json` hoặc `ja.json` thiếu hoặc thừa khóa so với `vi.json` làm `pnpm typecheck` báo lỗi.

```sh
pnpm typecheck
pnpm lint
```

Typecheck **không** bắt được:

- Giá trị của một ngôn ngữ còn là chuỗi của ngôn ngữ khác.
- Biến `{...}` hoặc thẻ khác nhau giữa các ngôn ngữ.
- Plural thiếu từ khóa.
- Mã lỗi trong `errors` không còn khớp với server.
- Giá trị sai thuật ngữ hoặc sai giọng văn.

`pnpm test tests/i18n-editor.test.ts` bắt một phần: thứ tự khóa và tập biến `{...}` giống nhau ở mọi file; với nhóm `editor`, chuỗi đúng chữ viết của ngôn ngữ, dấu câu tiếng Nhật toàn chiều rộng và không có khoảng trắng cạnh chữ Nhật, và mọi khóa mà mã editor gọi qua `t('…')` hoặc `translateEditor('…')` đều tồn tại. Phần còn lại phải tự rà bằng danh sách ở phần Placeholder và bảng thuật ngữ. Để so khóa nhanh giữa hai file:

```sh
node -e '
const f=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"?f(v,p+k+"."):[p+k]);
const L=n=>f(require("./src/data/i18n/"+n+".json")),vi=L("vi");
for(const n of ["en","ja"]){const o=L(n);console.log(n,{thiếu:vi.filter(k=>!o.includes(k)),thừa:o.filter(k=>!vi.includes(k))})}'
```

Sau khi sửa, chạy `pnpm dev`, đổi ngôn ngữ bằng nút ở giao diện và xem lại màn hình bị ảnh hưởng ở cả ba ngôn ngữ.

## Dịch bằng AI

- Đưa bảng thuật ngữ và danh sách không dịch vào prompt. Mô hình chỉ tuân theo khi được nhắc.
- Nêu rõ ngôn ngữ đích và 2–3 câu về ngữ cảnh màn hình (ví dụ: "thông báo lỗi dưới form đăng nhập").
- So lại tập biến và thẻ trước và sau khi dịch. Khác nhau là loại bỏ.
- Với dòng đã có sẵn, chạy `git log -- src/data/i18n/<file>` trước khi ghi đè. Giữ bản do người viết trừ khi thật sự sai.

## Lỗi hay gặp

- Dịch `Lancity`, `Google` hoặc từ viết tắt (`API`, `OAuth`).
- Để chuỗi ngôn ngữ khác trong một file vì "chưa kịp dịch".
- Thêm khóa vào `ja.json` nhưng quên `authMessages` (hoặc ngược lại) khi chuỗi thuộc luồng xác thực mở rộng.
- Trộn ログイン với サインアウト, hoặc dùng リンク cho "liên kết tài khoản".
- Mất dấu tiếng Việt hoặc dùng sai dấu thanh.
- Viết hoa từng chữ ("Tên Hiển Thị") hoặc "Create An Account".
- Đổi tên khóa `errors.*` mà không đổi mã lỗi tương ứng.
- Thêm `one` vào chuỗi plural tiếng Việt, hoặc thiếu `other` trong tiếng Anh.
- Viết cứng định dạng ngày/số trong chuỗi.
- Hai cách gọi cho cùng một khái niệm trong cùng luồng.
