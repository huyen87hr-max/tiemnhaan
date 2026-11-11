# Epsilon.Blue Soft — Material Master (ERP Attribute-Driven Training)

**Chức năng:** Quản trị dữ liệu chủ vật tư; không phải kho / tồn kho / chứng từ nhập xuất. Bản đào tạo công khai, không đăng nhập.

## Kiến trúc
- `index.html` + `assets/js/app.js`: UI tra cứu, tạo mã, chi tiết và barcode Code 128.
- `assets/data/config.json`: **chỉ cấu hình** nhóm, chủng loại, thuộc tính, các lựa chọn và đơn vị tính.
- `assets/js/material-rules.js`: bộ quy tắc dùng chung với GAS; định dạng, chuẩn hóa, tạo tên và đối chiếu thuộc tính.
- Google Sheets (`MATERIALS`, `NUMBER_RANGES`, `AUDIT_LOG`, `README`) là nguồn dữ liệu chính thức.
- GAS là nguồn cấp số chính thức `A000001+`; tính duy nhất, kiểm tra hợp lệ, tên và barcode của mã đã lưu đều xác định từ server. Người dùng không chọn hay sửa mã.

## Nghiệp vụ ERP
1. Chọn **nhóm vật tư**, **chủng loại kỹ thuật**. Biểu mẫu tự đổi theo lựa chọn.
2. Nhập thuộc tính bắt buộc (*), chương trình tự sinh **tên vật tư** và **quy cách** thống nhất.
3. Trong khi nhập, JavaScript lọc dữ liệu đã tải: `TRÙNG HOÀN TOÀN` chặn cấp mã, `GẦN GIỐNG` gợi ý tra cứu, `KHÔNG TRÙNG` cho phép Lưu.
4. Khi Lưu, GAS tự chuẩn hóa cùng quy tắc, đọc Google Sheets mới nhất dưới `LockService`, kiểm tra trùng và cấp số. Tên, đơn vị, mã, đặc tính kỹ thuật không nhận trực tiếp từ client.
5. Tạo thành công → xem chi tiết, barcode Code 128, in nhãn, xuất SVG; các học viên thấy mã mới sau khi đồng bộ danh mục.

## Cập nhật từ phiên bản không đăng nhập trước đó
- 374 mã Excel lịch sử được **bảo toàn** (không tự đổi tên), mã đã cấp `A000001` cũng không bị thay đổi.
- Trên Google Sheets, `MATERIALS` thêm **cột U = attributesJson** cuối bảng để lưu thuộc tính có cấu trúc **chỉ cho mã mới**. 20 cột cũ được giữ nguyên, cột T `requestId` không đổi.
- GAS tự tạo thêm cột U khi chạy lại `mmSetup()`. Không khởi tạo lại danh mục, không đặt lại NUMBER_RANGES.
- Config JSON và bộ quy tắc GAS phải cùng phiên bản `erp-attribute-v1`.
- Khi GAS còn bản cũ, frontend vẫn đọc danh mục nhưng **khóa nút cấp mã** kèm hướng dẫn triển khai.

## Bật bản mới (chủ Google Sheets thao tác)
1. Mở bảng Google Sheets **Material Master đang được gắn GAS**, tạo bản sao lưu.
2. Apps Script: thay nội dung `Code.gs` bằng file mới trong thư mục `2. Database` / `_GPT ban giao`.
3. Chạy `mmSetup()` **một lần** để nâng cấp cột U, kiểm tra `mmCheckSetup()`; xác nhận 374 mã lịch sử + mã A... đã phát sinh, `nextCode` không bị lùi.
4. Nếu dùng chế độ công khai trong buổi học, chạy `mmEnableTrainingMode()` nếu chưa bật.
5. `Deploy` → `Manage deployments` → `Edit` (biểu tượng bút chì) → **New version** → `Deploy`. Giữ **Execute as Me**, **Who has access Anyone** nếu chủ động cho phép công khai.
6. Mở `index.html` bằng VS Code Live Server, Ctrl+Shift+R để tải mới. Không cần sửa URL GAS nếu dùng lại cùng deployment.

**Bảo mật:** `Anyone` + chế độ đào tạo cho phép mọi người biết endpoint xem và gửi đề nghị tạo mã; không sử dụng dữ liệu nội bộ nhạy cảm. API sửa/xóa/audit vẫn đòi xác thực. Sau buổi học chạy `mmDisableTrainingMode()`.

## Kiểm thử
Kiểm tra cú pháp JS/GAS, backend mô phỏng GAS/Sheets, giao diện Playwright desktop/mobile. Không thay cho smoke test trực tiếp trên deployment và máy in mã vạch thật. Chi tiết ở `_GPT ban giao/BAO_CAO_KIEM_THU.md`.
