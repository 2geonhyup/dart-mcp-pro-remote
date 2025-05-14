# DART MCP 서버 TypeScript 구현 Todo

## 1. 환경 설정

- [x] **환경변수 설정**: `dotenv` 패키지를 사용하여 API 키와 같은 환경 변수를 로드합니다.
- [x] **상수 정의**: 보고서 코드, 재무상태표 항목, 현금흐름표 항목 등의 상수를 정의합니다.

## 2. 헬퍼 함수 구현

### 회사 검색 및 정보 조회
- [x] `get_corp_code_by_name`: 회사명으로 고유번호 검색
- [x] `get_disclosure_list`: 기업의 정기공시 목록 조회
- [x] `adjust_end_date`: 공시 제출 기간 고려하여 종료일 조정
- [x] `determine_report_code`: 보고서 이름에서 코드 추출
- [x] `get_report_code_name`: 보고서 코드에 해당하는 이름 반환
- [x] `get_statement_name`: 재무제표 구분 코드에 해당하는 이름 반환

### XBRL 처리 관련
- [x] `get_financial_statement_xbrl`: 재무제표 원본파일(XBRL) 다운로드 및 처리
- [x] `detect_namespaces`: XBRL 문서에서 네임스페이스 추출
- [x] `extract_fiscal_year`: contextRef에서 회계연도 추출
- [x] `get_pattern_by_item_type`: 항목 유형에 따른 패턴 선택
- [x] `format_numeric_value`: XBRL 숫자 값 포맷팅
- [x] `parse_xbrl_financial_data`: XBRL 파싱하여 재무 데이터 추출

### 문서 처리 관련
- [x] `get_original_document`: DART 공시서류 원본파일 다운로드
- [x] `extract_business_section`: 원본파일에서 특정 비즈니스 섹션 추출
- [x] `extract_business_section_from_dart`: DART API로 비즈니스 섹션 추출
- [x] `get_financial_json`: 단일회사 전체 재무제표를 JSON으로 가져오기

## 3. MCP 도구 구현

### 주요 도구
- [x] `get_current_date`: 현재 날짜를 YYYYMMDD 형식으로 반환
- [x] `search_disclosure`: 회사의 주요 재무 정보 검색
- [x] `search_detailed_financial_data`: 회사의 세부적인 재무 정보 제공
- [x] `search_business_information`: 회사의 사업 관련 현황 정보 제공
- [x] `search_json_financial_data`: JSON API를 통한 재무 정보 검색 (대안 도구)

## 4. TypeScript 구현 세부 사항

### 클래스 및 타입 설정
- [x] DartMCP 클래스 정의 
- [x] CompanyInfo 인터페이스 정의
- [x] DisclosureItem 인터페이스 정의
- [x] FinancialData 인터페이스 정의
- [x] XbrlContext 인터페이스 정의
- [x] 기타 필요한 인터페이스 및 타입 정의

### API 및 유틸리티 함수 구현
- [x] API 호출 유틸리티 함수 구현 (callDartApi)
- [x] XML 처리 유틸리티 함수 구현 (fast-xml-parser 또는 xml2js 사용)
- [x] ZIP 파일 처리 유틸리티 구현 (adm-zip 또는 jszip 사용)

## 5. 구현 단계

- [x] **기본 설정 구현**: 환경변수 로드, 상수 정의
- [x] **헬퍼 함수 구현**: 회사 검색, API 호출, XML/XBRL 처리 함수 등
- [x] **MCP 도구 구현**: 5개의 주요 도구 함수 구현
- [x] **서버 초기화 및 연결**

## 6. 주의사항 적용

- [x] Python의 `asyncio`를 TypeScript의 Promise로 변환
- [x] 오류 처리 및 예외 잡기 패턴 조정
- [x] XML, ZIP 파일 처리를 위한 라이브러리 통합
- [x] 문자열 처리 및 정규 표현식 패턴 조정
- [x] TypeScript의 타입 안전성 적용
- [x] 네임스페이스와 컨텍스트 관리 메커니즘 구현

## 7. 현재 상태

- 모든 헬퍼 함수와 MCP 도구가 구현됨
- 타입 안전성 적용 완료
- ctx 객체 관련 이슈 해결 (console.log로 대체)
- 서버 초기화 준비 완료

## 8. 추가 개선사항 (필요시)

- 환경변수 검증 로직 추가
- 오류 메시지 다국어 지원
- 테스트 케이스 작성
- 캐싱 메커니즘 추가
- 로깅 시스템 개선
