# Định dạng issue type

## (a) PD đã chuyển

| PD | Kết quả | Mã |
| --- | --- | --- |
| 1441 | Port. `formatIssueType` trả về tên issue type như `IssueType.__str__`. | [presenters.ts](../../../src/server/issue-type/presenters.ts) |
| 1442 | Port. `formatProjectIssueType` trả về `Tên project <Tên workspace> - Tên issue type`, dùng chung `formatProject` cho phần project. | [presenters.ts](../../../src/server/issue-type/presenters.ts) |

Các hàm tương ứng với `__str__` của model Plane. Ca kiểm thử đối chiếu trực tiếp cả hai chuỗi. [issue-type.test.ts](../../../tests/issue-type.test.ts)
