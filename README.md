# DART MCP 서버

금융감독원 DART 공시 시스템 데이터를 활용하여 기업 재무정보를 제공하는 Model Context Protocol(MCP) 서버입니다.

## 주요 기능

- 회사의 주요 재무 정보 검색 (`search_disclosure`)
- 회사의 세부적인 재무 정보 제공 (`search_detailed_financial_data`)
- 회사의 사업 관련 현황 정보 제공 (`search_business_information`)
- JSON API를 통한 재무 정보 검색 (`search_json_financial_data`)
- 현재 날짜 반환 (`get_current_date`)

## 설치 방법

1. 필요한 패키지 설치
   ```bash
   npm install dotenv fast-xml-parser xml2js jszip axios zod @modelcontextprotocol/sdk
   ```

2. 환경 변수 설정
   - 프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 다음 내용을 추가합니다:
   ```
   DART_API_KEY=your_api_key_here
   ```
   - DART API 키는 [DART OpenAPI](https://opendart.fss.or.kr) 사이트에서 발급받을 수 있습니다.

## 사용 방법

```typescript
// 서버 실행
import { DartMCP } from './src/index';

const agent = new DartMCP();
agent.init();
```

## API 도구

### 1. 현재 날짜 조회

현재 날짜를 YYYYMMDD 형식으로 반환합니다.

```typescript
const result = await agent.search_disclosure();
// 예: "20240601"
```

### 2. 회사 재무 정보 검색

회사의 주요 재무 정보를 검색합니다.

```typescript
const result = await agent.search_disclosure({
  company_name: "삼성전자",
  start_date: "20220101",
  end_date: "20231231",
  requested_items: ["매출액", "영업이익"]
});
```

### 3. 세부 재무 정보 검색

회사의 세부적인 재무제표 정보를 검색합니다.

```typescript
const result = await agent.search_detailed_financial_data({
  company_name: "삼성전자",
  statement_type: "재무상태표",
  year: "2023",
  is_consolidated: true
});
```

### 4. 사업 정보 검색

회사의 사업 현황 정보를 검색합니다.

```typescript
const result = await agent.search_business_information({
  company_name: "삼성전자",
  section_type: "사업의 개요"
});
```

### 5. JSON 형식 재무 데이터 검색

API를 통해 재무 데이터를 JSON 형식으로 제공합니다.

```typescript
const result = await agent.search_json_financial_data({
  company_name: "삼성전자",
  bsns_year: "2023",
  reprt_code: "11011",  // 사업보고서
  fs_div: "CFS"        // 연결재무제표
});
```

## 라이선스

MIT License

## 주의사항

- DART API 키는 일일 API 호출 제한이 있으므로 과도한 요청에 주의하세요.
- 이 서버는 Model Context Protocol(MCP)을 기반으로 작동하며, 대규모 언어 모델(LLM)과 함께 사용할 때 최적의 성능을 발휘합니다.
