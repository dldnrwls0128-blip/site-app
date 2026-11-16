# 현장관리

건설현장 시공관리인용 오프라인 현장관리 PWA 뼈대입니다. **기획 명세 v0.3**을 따릅니다. 빌드 도구 없이 순수 HTML/CSS/JS(ES modules)로 동작하며, 라이브러리는 `vendor/`에 로컬로 넣어 두어 외부 서버 없이 쓸 수 있습니다.

## 실행 방법

```bash
cd site-app
python3 -m http.server 8080
```

브라우저에서 http://localhost:8080 을 연 뒤, 모바일에서 «홈 화면에 추가»로 설치할 수 있습니다. `file://`로는 ES module·서비스 워커가 제한됩니다.

## 폴더 구조

```
site-app/
  index.html
  manifest.webmanifest     # 이름: 현장관리, 아이콘 192/512
  sw.js                    # 앱 셸 캐시, 오프라인
  css/app.css
  data/checklistTemplates.json   # 기본 템플릿(임시 예시, 교체 가능)
  js/   db.js ctx.js settings.js items.js templates.js
        media.js speech.js inspect.js drawings.js backup.js app.js
  icons/  vendor/  screenshots/  scripts/
```

## 데이터 (IndexedDB `hyeonjang-gwanri`)

- `sites` `{id, name}` — 현장명
- `locations` `{id, siteId, parentId, type: 동|층|호수|구역, name, order, floorNo?, isCommon?, isCommonArea?, area?}`. 가상 동 «공용»(`isCommon`) 아래에 공용구역을 둔다. 지하주차장은 B2·B1. 화면·PDF·엑셀 표기는 `공용 · 지하주차장 B1`처럼 `formatLocation`으로 통일한다. 코어는 각 동의 호수/부위에서 고른다.
- `trades` `{id, name, order}`
- `records` `{id, type: photo|video|memo|issue|inspection|quality, locationId, tradeId, createdAt, author, status, title, text, mediaIds[], extra}`
- `media` `{id, recordId, blob, mime, thumb, createdAt}`
- `checklistTemplates` `{id, tradeId, name, category: inspection|quality, requirePhoto, items[]}`
- `drawings` `{id, locationId(동), tradeId, name, pdfBlob}` — 층에 연결하지 않음

검측 `records.extra` 요지:

```
docNo, requestDateTime, part, subTrade, locationSentence, matters, selfOpinion,
results: [{ itemId, self:{value,note}, supervisor:{value,note}, photoNos[] }],
finalResult: 합격|불합격, nonconformity, action, parentInspectionId, parentDocNo, attachments
```

항목 `items[].kind`: `check` | `number` | `text` | `time`. 템플릿 `type`/`kind`를 그대로 값 칸에 저장합니다. `time`은 `nowButton: true`인 항목만 «지금» 버튼이 있습니다. 차량번호(`text`)는 일반 텍스트(한글 포함)이며, 최근 입력 5~8개를 칩으로 다시 넣을 수 있습니다.

## 화면

- **홈**: 현재 위치 카드(동·층 필수, 호수·부위 선택). 공식 칸 문장 예: `301동 15층 슬래브`. 위치 선택기 동 그리드 마지막 칸은 가상 동 «공용»(표기 예: `공용 · 지하주차장 B1`). 2×2 버튼: 촬영 · 검측 · 기록 · 품질시험(최소 56dp).
- **기록**: 한 화면. 기본은 지적, «지적 아님» 토글이면 메모. 별도 메모/지적 화면은 없습니다.
- **검측** 2단계: 1) 시공자 자체점검 — 결과 미입력·필수 사진 누락·합격 의견 미입력을 «자체점검 N개 남음»으로 집계한다. N이 1개 이상이면 «요청»에 실제 HTML `disabled`와 `aria-disabled`를 함께 붙인다. 남은 개수는 결과 선택·해당없음·합격 의견 입력·사진 추가/삭제 때마다 `syncRequestState`로 다시 계산한다. 첫 미충족 항목으로의 스크롤은 버튼 위 «자체점검 N개 남음»을 탭할 때만 한다. «작성 저장»은 필수 사진 없이도 초안을 남긴다. 2) 감리 검측 결과. 판정은 합격/불합격만. 불합격 시 재검측(`extra.parentInspectionId`).
- **품질시험**: 콘크리트 타설 중(슬럼프·공기량·염화물·공시체 수량·차량번호·생산·도착·타설완료 시각). `photoRequired` 항목은 촬영/선택과 썸네일이 있고, 사진이 없으면 저장이 잠긴다. 해당없음이면 사진이 면제된다. 시방값이 있을 때만 기준을 벗어나면 빨간색. 엑셀은 차량(배치) 1대=1행, 항목별 열(타설 관리대장용). 타설 전 검측은 별도 체크리스트.
- **조회 / 도면 / 설정**: 조회 필터, 도면은 동·공종 태그 + 파일명 검색. 설정에는 사용자명(author 자동), 공사명, 수신(총괄감리원), 서명 4칸 이름, 동별 최하층·최상층·호수 수 구조 생성, 공용구역(프리셋: 지하주차장·옥상·기계·전기실·피트·단지 외부 + 직접 입력. 코어는 각 동 호수/부위), 템플릿 JSON 가져오기, 백업, 데이터 삭제.

## 검측요청서 PDF

주택건설공사 감리업무 세부기준 **별지 제6호** 요지입니다. 문서번호 자동, 수신+공사명, 위치 및 공종, 검측 부위, 검측 요구 일시, 검측 사항, 체크리스트 결과 2줄(위 자체점검·아래 감리), 부적합 내용과 조치, 최종 결과, 서명 4칸(이름만, 서명란은 빈칸), 붙임, 사진대지. 재검측은 우측 상단 붉은 `(재)`와 원본 문서번호. 협력사 칸은 없습니다. 엑셀은 같은 칸을 한 시트에 평면으로, 사진은 번호만.

한글은 로컬 `NotoSansKR-Regular.ttf`를 jsPDF에 임베드합니다.

## 템플릿

`data/checklistTemplates.json`은 `/workspace/qa/checklistTemplates.json`을 앱 형식으로 변환한 것입니다(`version`이 올라가면 기존 DB의 기본 템플릿도 갱신). 설정에서 JSON으로 다시 덮어쓸 수 있습니다.

## 사진 워터마크 · 음성 입력

`js/media.js`의 `addWatermark`가 위치·공종·일시·작성자를 canvas로 넣습니다. 영상에는 적용하지 않습니다.

음성 입력은 Web Speech API를 쓰며, **오프라인에서는 동작하지 않을 수 있습니다.** 텍스트 입력은 항상 제공합니다.

## 검증

```bash
python3 -m http.server 8765
node scripts/verify.mjs   # BASE_URL, CHROME 환경변수 사용 가능
```

모바일 뷰포트(390×844) 스크린샷이 `screenshots/`에 저장되고, 서비스 워커·IndexedDB·백업 왕복·한글 PDF를 확인합니다.
