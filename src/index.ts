import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import dotenv from "dotenv";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import JSZip from "jszip";
import { promisify } from "util";
import * as xml2js from "xml2js";

// 환경 변수 로드
dotenv.config();

// API 설정
const API_KEY = "c5f3fef1bf61d6fb9dfd3d9b40290f133b6d406a";
const BASE_URL = "https://opendart.fss.or.kr/api";

// 보고서 코드
const REPORT_CODE = {
	"사업보고서": "11011",
	"반기보고서": "11012",
	"1분기보고서": "11013",
	"3분기보고서": "11014"
};

// 재무상태표 항목 리스트
const BALANCE_SHEET_ITEMS = [
	"유동자산", "비유동자산", "자산총계", 
	"유동부채", "비유동부채", "부채총계", 
	"자본금", "자본잉여금", "이익잉여금", "기타자본항목", "자본총계"
];

// 현금흐름표 항목 리스트
const CASH_FLOW_ITEMS = ["영업활동 현금흐름", "투자활동 현금흐름", "재무활동 현금흐름"];

// 보고서 유형별 contextRef 패턴 정의
const REPORT_PATTERNS = {
	"연간": "FY",
	"3분기": "TQQ",  // 손익계산서는 TQQ
	"반기": "HYA",
	"1분기": "FQA"
};

// 현금흐름표용 특별 패턴
const CASH_FLOW_PATTERNS = {
	"연간": "FY",
	"3분기": "TQA",  // 현금흐름표는 TQA
	"반기": "HYA",
	"1분기": "FQA"
};

// 재무상태표용 특별 패턴
const BALANCE_SHEET_PATTERNS = {
	"연간": "FY",
	"3분기": "TQA",  // 재무상태표도 TQA
	"반기": "HYA",
	"1분기": "FQA"
};

// 데이터 무효/오류 상태 표시자
const INVALID_VALUE_INDICATORS = new Set(["N/A", "XBRL 파싱 오류", "데이터 추출 오류"]);

// 재무제표 유형 정의
const STATEMENT_TYPES = {
	"재무상태표": "BS",
	"손익계산서": "IS", 
	"현금흐름표": "CF"
};

// 세부 항목 태그 정의
const DETAILED_TAGS = {
	"재무상태표": {
		"유동자산": ["ifrs-full:CurrentAssets"],
		"비유동자산": ["ifrs-full:NoncurrentAssets"],
		"자산총계": ["ifrs-full:Assets"],
		"유동부채": ["ifrs-full:CurrentLiabilities"],
		"비유동부채": ["ifrs-full:NoncurrentLiabilities"],
		"부채총계": ["ifrs-full:Liabilities"],
		"자본금": ["ifrs-full:IssuedCapital"],
		"자본잉여금": ["ifrs-full:SharePremium"],
		"이익잉여금": ["ifrs-full:RetainedEarnings"],
		"기타자본항목": ["dart:ElementsOfOtherStockholdersEquity"],
		"자본총계": ["ifrs-full:Equity"]
	},
	"손익계산서": {
		"매출액": ["ifrs-full:Revenue"],
		"매출원가": ["ifrs-full:CostOfSales"],
		"매출총이익": ["ifrs-full:GrossProfit"],
		"판매비와관리비": ["dart:TotalSellingGeneralAdministrativeExpenses"],
		"영업이익": ["dart:OperatingIncomeLoss"],
		"금융수익": ["ifrs-full:FinanceIncome"],
		"금융비용": ["ifrs-full:FinanceCosts"],
		"법인세비용차감전순이익": ["ifrs-full:ProfitLossBeforeTax"],
		"법인세비용": ["ifrs-full:IncomeTaxExpenseContinuingOperations"],
		"당기순이익": ["ifrs-full:ProfitLoss"],
		"기본주당이익": ["ifrs-full:BasicEarningsLossPerShare"]
	},
	"현금흐름표": {
		"영업활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInOperatingActivities"],
		"영업에서 창출된 현금": ["ifrs-full:CashFlowsFromUsedInOperations"],
		"이자수취": ["ifrs-full:InterestReceivedClassifiedAsOperatingActivities"],
		"이자지급": ["ifrs-full:InterestPaidClassifiedAsOperatingActivities"],
		"배당금수취": ["ifrs-full:DividendsReceivedClassifiedAsOperatingActivities"],
		"법인세납부": ["ifrs-full:IncomeTaxesPaidRefundClassifiedAsOperatingActivities"],
		"투자활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInInvestingActivities"],
		"유형자산의 취득": ["ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
		"무형자산의 취득": ["ifrs-full:PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities"],
		"유형자산의 처분": ["ifrs-full:ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
		"재무활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInFinancingActivities"],
		"배당금지급": ["ifrs-full:DividendsPaidClassifiedAsFinancingActivities"],
		"현금및현금성자산의순증가": ["ifrs-full:IncreaseDecreaseInCashAndCashEquivalents"],
		"기초현금및현금성자산": ["dart:CashAndCashEquivalentsAtBeginningOfPeriodCf"],
		"기말현금및현금성자산": ["dart:CashAndCashEquivalentsAtEndOfPeriodCf"]
	}
};

const chat_guideline = "\n* 제공된 공시정보들은 분기, 반기, 연간이 섞여있을 수 있습니다. \n사용자가 특별히 연간이나 반기데이터만을 원하는게 아니라면, 주어진 데이터를 적당히 가공하여 분기별로 사용자에게 제공하세요.";

// 인터페이스 정의
interface CompanyInfo {
	code: string;
	name: string;
}

interface DisclosureItem {
	rcept_no: string;
	rcept_dt: string;
	report_nm: string;
	corp_code: string;
	corp_name: string;
	stock_code: string;
	[key: string]: string;
}

interface FinancialData {
	[key: string]: string;
}

interface XbrlContext {
	namespaces: Record<string, string>;
	contextRefs: Set<string>;
	fiscalYear: string;
}

// API 유틸리티 함수
/**
 * DART API를 호출하는 유틸리티 함수
 * @param endpoint API 엔드포인트
 * @param params 요청 파라미터
 * @returns API 응답 또는 오류 메시지
 */
async function callDartApi(endpoint: string, params: Record<string, string>): Promise<any> {
	try {
		// crtfc_key 파라미터에 API_KEY 추가
		const queryParams = new URLSearchParams({ crtfc_key: API_KEY, ...params });
		const url = `${BASE_URL}/${endpoint}?${queryParams}`;
		
		const response = await axios.get(url);
		return response.data;
	} catch (error) {
		if (axios.isAxiosError(error)) {
			return { error: `API 요청 실패: HTTP 상태 코드 ${error.response?.status || '알 수 없음'}` };
		}
		return { error: `API 요청 중 오류 발생: ${error}` };
	}
}

/**
 * 회사명으로 회사의 고유번호를 검색하는 함수
 * @param corp_name 검색할 회사명
 * @returns [고유번호, 기업이름] 튜플, 찾지 못한 경우 ["", 오류메시지]
 */
async function getCorpCodeByName(corp_name: string): Promise<[string, string]> {
	try {
		// API 엔드포인트 호출
		const response = await axios.get(`${BASE_URL}/corpCode.xml`, {
			params: {
				crtfc_key: API_KEY
			},
			responseType: 'arraybuffer'
		});

		if (response.status !== 200) {
			return ["", `API 요청 실패: HTTP 상태 코드 ${response.status}`];
		}

		// ZIP 파일 처리
		const zip = new JSZip();
		const zipFile = await zip.loadAsync(response.data);
		
		// CORPCODE.xml 파일 추출
		const xmlFile = zipFile.file('CORPCODE.xml');
		if (!xmlFile) {
			return ["", "ZIP 파일에서 CORPCODE.xml을 찾을 수 없습니다."];
		}
		
		const xmlContent = await xmlFile.async('string');
		
		// XML 파싱
		try {
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: "",
				textNodeName: "text",
				isArray: (name) => name === "list", // list 태그는 항상 배열로 처리
				parseAttributeValue: false // 속성값을 문자열 그대로 유지
			});
			
			const result = parser.parse(xmlContent);
			
			// XML 구조 검사 및 회사 목록 추출
			if (!result || !result.result) {
				console.error("XML 파싱 결과에서 result 객체를 찾을 수 없습니다:", result);
				return ["", "XML 파싱 결과에서 result 객체를 찾을 수 없습니다."];
			}
			
			if (!result.result.list) {
				console.error("XML 파싱 결과에서 회사 목록을 찾을 수 없습니다:", result.result);
				return ["", "XML 파싱 결과에서 회사 목록을 찾을 수 없습니다."];
			}
			
			// companies는 항상 배열로 처리 (isArray 설정으로 필요 없을 수 있지만 안전을 위해 유지)
			const companies = Array.isArray(result.result.list) ? result.result.list : [result.result.list];
			
			if (companies.length === 0) {
				console.error("XML 파싱 결과에서 회사 목록이 비어 있습니다.");
				return ["", "XML 파싱 결과에서 회사 목록이 비어 있습니다."];
			}
			
			console.log(`총 ${companies.length}개 회사 정보를 읽었습니다.`);
			
			// 검색어를 포함하는 모든 회사 찾기
			const matches: Array<{name: string, code: string, score: number}> = [];
			
			for (const company of companies) {
				// 회사 객체가 유효한지 확인
				if (!company || typeof company !== 'object') continue;
				if (!company.corp_name || !company.corp_code) continue;
				
				const name = company.corp_name;
				
				// 모든 회사를 검색 대상으로 포함 (stock_code 필터링 제거)
				if (name && name.includes(corp_name)) {
					// 일치도 점수 계산 (낮을수록 더 정확히 일치)
					let score = 0;
					if (name !== corp_name) {
						score += Math.abs(name.length - corp_name.length);
						if (!name.startsWith(corp_name)) {
							score += 10;
						}
					}
					
					const code = company.corp_code;
					matches.push({ name, code, score });
				}
			}
			
			// 일치하는 회사가 없는 경우
			if (matches.length === 0) {
				return ["", `'${corp_name}' 회사를 찾을 수 없습니다.`];
			}
			
			console.log(`'${corp_name}' 검색어로 ${matches.length}개 회사를 찾았습니다.`);
			
			// 일치도 점수가 가장 낮은 (가장 일치하는) 회사 반환
			matches.sort((a, b) => a.score - b.score);
			return [matches[0].code, matches[0].name];
		} catch (parseError) {
			console.error("XML 파싱 중 오류 발생:", parseError);
			return ["", `XML 파싱 중 오류 발생: ${parseError instanceof Error ? parseError.message : String(parseError)}`];
		}
	} catch (error) {
		console.error("회사 코드 조회 중 오류 발생:", error);
		if (error instanceof Error) {
			return ["", `회사 코드 조회 중 오류 발생: ${error.message}`];
		}
		return ["", "알 수 없는 오류로 회사 정보를 찾을 수 없습니다."];
	}
}

/**
 * 기업의 정기공시 목록을 조회하는 함수
 * @param corp_code 회사 고유번호(8자리)
 * @param start_date 시작일(YYYYMMDD)
 * @param end_date 종료일(YYYYMMDD)
 * @returns [공시 목록 리스트, 오류 메시지] 튜플. 성공 시 [목록, null], 실패 시 [빈 리스트, 오류 메시지]
 */
async function getDisclosureList(corp_code: string, start_date: string, end_date: string): Promise<[DisclosureItem[], string | null]> {
	try {
		// 정기공시(A) 유형만 조회
		const response = await axios.get(`${BASE_URL}/list.json`, {
			params: {
				crtfc_key: API_KEY,
				corp_code: corp_code,
				bgn_de: start_date,
				end_de: end_date,
				pblntf_ty: 'A',
				page_count: 100
			}
		});
		
		if (response.status !== 200) {
			return [[], `API 요청 실패: HTTP 상태 코드 ${response.status}`];
		}
		
		const result = response.data;
		
		if (result.status !== '000') {
			const status = result.status || '알 수 없음';
			const msg = result.message || '알 수 없는 오류';
			return [[], `DART API 오류: ${status} - ${msg}`];
		}
		
		return [result.list || [], null];
		
	} catch (error) {
		if (axios.isAxiosError(error)) {
			return [[], `API 요청 중 네트워크 오류 발생: ${error.message}`];
		}
		
		if (error instanceof Error) {
			return [[], `공시 목록 조회 중 오류 발생: ${error.message}`];
		}
		
		return [[], "알 수 없는 오류로 공시 목록을 조회할 수 없습니다."];
	}
}

/**
 * 공시 제출 기간을 고려하여 종료일 조정
 * @param end_date 원래 종료일 (YYYYMMDD)
 * @returns [조정된 종료일, 조정 여부]
 */
function adjustEndDate(end_date: string): [string, boolean] {
	try {
		// 입력된 end_date를 Date 객체로 변환
		const endDateObj = new Date(
			parseInt(end_date.substring(0, 4)),
			parseInt(end_date.substring(4, 6)) - 1,
			parseInt(end_date.substring(6, 8))
		);
		
		// 95일 추가
		const adjustedEndDateObj = new Date(endDateObj);
		adjustedEndDateObj.setDate(adjustedEndDateObj.getDate() + 95);
		
		// 현재 날짜보다 미래인 경우 현재 날짜로 조정
		const currentDate = new Date();
		if (adjustedEndDateObj > currentDate) {
			adjustedEndDateObj.setTime(currentDate.getTime());
		}
		
		// 포맷 변환하여 문자열로 반환
		const adjustedEndDate = `${adjustedEndDateObj.getFullYear()}${
			String(adjustedEndDateObj.getMonth() + 1).padStart(2, '0')
		}${
			String(adjustedEndDateObj.getDate()).padStart(2, '0')
		}`;
		
		// 조정 여부 반환
		return [adjustedEndDate, adjustedEndDate !== end_date];
	} catch (error) {
		// 오류 발생 시 원래 값 그대로 반환
		console.error('날짜 조정 중 오류 발생:', error);
		return [end_date, false];
	}
}

/**
 * 보고서 이름으로부터 보고서 코드 결정
 * @param report_name 보고서 이름
 * @returns 해당하는 보고서 코드 또는 null
 */
function determineReportCode(report_name: string): string | null {
	if (report_name.includes("사업보고서")) {
		return REPORT_CODE["사업보고서"];
	} else if (report_name.includes("반기보고서")) {
		return REPORT_CODE["반기보고서"];
	} else if (report_name.includes("분기보고서")) {
		if (report_name.includes(".03)") || report_name.includes("(1분기)")) {
			return REPORT_CODE["1분기보고서"];
		} else if (report_name.includes(".09)") || report_name.includes("(3분기)")) {
			return REPORT_CODE["3분기보고서"];
		}
	}
	
	return null;
}

/**
 * 보고서 코드에 해당하는 보고서 이름을 반환하는 함수
 * @param reprt_code 보고서 코드
 * @returns 보고서 이름
 */
function getReportCodeName(reprt_code: string): string {
	const code_to_name: Record<string, string> = {
		"11011": "사업보고서",
		"11012": "반기보고서",
		"11013": "1분기보고서",
		"11014": "3분기보고서"
	};
	
	return code_to_name[reprt_code] || "알 수 없는 보고서";
}

/**
 * 재무제표 구분 코드에 해당하는 재무제표 이름을 반환하는 함수
 * @param sj_div 재무제표 구분 코드
 * @returns 재무제표 이름
 */
function getStatementName(sj_div: string): string {
	const div_to_name: Record<string, string> = {
		"BS": "재무상태표",
		"IS": "손익계산서",
		"CIS": "포괄손익계산서",
		"CF": "현금흐름표",
		"SCE": "자본변동표"
	};
	
	return div_to_name[sj_div] || "알 수 없는 재무제표";
}

/**
 * XBRL 문서에서 네임스페이스를 추출하고 기본 네임스페이스와 병합
 * @param xbrl_content XBRL 문서 내용
 * @param base_namespaces 기본 네임스페이스 딕셔너리
 * @returns [업데이트된 네임스페이스 딕셔너리, 감지된 네임스페이스 딕셔너리]
 */
function detectNamespaces(xbrl_content: string, base_namespaces: Record<string, string>): [Record<string, string>, Record<string, string>] {
	const namespaces = { ...base_namespaces };
	const detected: Record<string, string> = {};
	
	try {
		// 정규 표현식을 사용하여 네임스페이스 추출
		const nsRegex = /xmlns:([^=]+)="([^"]+)"/g;
		let match;
		
		while ((match = nsRegex.exec(xbrl_content)) !== null) {
			const prefix = match[1];
			const uri = match[2];
			
			if (prefix && !namespaces[prefix]) {
				namespaces[prefix] = uri;
				detected[prefix] = uri;
			} else if (prefix && namespaces[prefix] !== uri) {
				namespaces[prefix] = uri;
				detected[prefix] = uri;
			}
		}
	} catch (error) {
		console.error('네임스페이스 감지 실패:', error);
		// 네임스페이스 감지 실패 시 기본값 사용
	}
	
	return [namespaces, detected];
}

/**
 * contextRef 집합에서 회계연도 추출
 * @param context_refs XBRL 문서에서 추출한 contextRef 집합
 * @returns 감지된 회계연도 또는 현재 연도
 */
function extractFiscalYear(context_refs: Set<string>): string {
	for (const context_ref of context_refs) {
		if (context_ref.includes('CFY') && context_ref.length > 7) {
			const match = /CFY(\d{4})/.exec(context_ref);
			if (match) {
				return match[1];
			}
		}
	}
	
	// 회계연도를 찾지 못한 경우, 현재 연도를 사용
	return new Date().getFullYear().toString();
}

/**
 * 항목 유형에 따른 적절한 패턴 선택
 * @param item_name 재무 항목 이름
 * @returns 항목 유형에 맞는 패턴 딕셔너리
 */
function getPatternByItemType(item_name: string): Record<string, string> {
	// 현금흐름표 항목 확인
	if (CASH_FLOW_ITEMS.includes(item_name) || Object.keys(DETAILED_TAGS["현금흐름표"]).includes(item_name)) {
		return CASH_FLOW_PATTERNS;
	}
	
	// 재무상태표 항목 확인
	else if (BALANCE_SHEET_ITEMS.includes(item_name) || Object.keys(DETAILED_TAGS["재무상태표"]).includes(item_name)) {
		return BALANCE_SHEET_PATTERNS;
	}
	
	// 손익계산서 항목 (기본값)
	else {
		return REPORT_PATTERNS;
	}
}

/**
 * XBRL 숫자 값을 포맷팅
 * @param value_text 숫자 텍스트
 * @param decimals 소수점 자리수 지정 (숫자 또는 "INF")
 * @returns 포맷팅된 숫자 문자열
 */
function formatNumericValue(value_text: string, decimals: string): string {
	const numeric_value = parseFloat(value_text.replace(',', ''));
	
	// decimals가 "INF"인 경우 원본 값 그대로 사용
	if (decimals === "INF") {
		if (numeric_value === Math.floor(numeric_value)) {
			return Math.floor(numeric_value).toLocaleString();
		} else {
			return numeric_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}
	}
	
	// 일반적인 경우 decimals에 따라 스케일 조정
	const adjusted_value = numeric_value * (10 ** -parseInt(decimals));
	
	if (adjusted_value === Math.floor(adjusted_value)) {
		return Math.floor(adjusted_value).toLocaleString();
	} else {
		return adjusted_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
}

/**
 * XBRL 텍스트 내용을 파싱하여 지정된 항목의 재무 데이터를 추출
 * @param xbrl_content XBRL 파일의 전체 텍스트 내용
 * @param items_and_tags 추출할 항목과 태그 리스트 딕셔너리
 * @returns 추출된 재무 데이터 딕셔너리 {'항목명': '값'}
 */
function parseXbrlFinancialData(xbrl_content: string, items_and_tags: Record<string, string[]>): FinancialData {
	const extracted_data: FinancialData = {};
	
	// 모든 항목 이름에 대해 "N/A" 초기값 설정
	for (const item_name of Object.keys(items_and_tags)) {
		extracted_data[item_name] = "N/A";
	}
	
	// 기본 네임스페이스 정의
	const base_namespaces: Record<string, string> = {
		'ifrs-full': 'http://xbrl.ifrs.org/taxonomy/2021-03-24/ifrs-full',
		'dart': 'http://dart.fss.or.kr/xbrl/dte/2019-10-31',
		'kor-ifrs': 'http://www.fss.or.kr/xbrl/kor/kor-ifrs/2021-03-24',
	};

	try {
		// XML 파서 준비
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "",
			attributesGroupName: "@_",
			textNodeName: "#text",
			isArray: (name, jpath, isLeafNode, isAttribute) => false
		});
		
		// XBRL 파싱
		const root = parser.parse(xbrl_content);
		
		// 네임스페이스 추출 및 업데이트
		const [namespaces, _] = detectNamespaces(xbrl_content, base_namespaces);
		
		// 모든 contextRef 값 수집
		const all_context_refs = new Set<string>();
		// XML 문서에서 contextRef 속성 추출
		const contextRefRegex = /contextRef="([^"]+)"/g;
		let match;
		while ((match = contextRefRegex.exec(xbrl_content)) !== null) {
			all_context_refs.add(match[1]);
		}
		
		// 회계연도 추출
		const fiscal_year = extractFiscalYear(all_context_refs);
		
		// 각 항목별 태그 검색 및 값 추출
		for (const [item_name, tag_list] of Object.entries(items_and_tags)) {
			let item_found = false;
			
			for (const tag of tag_list) {
				if (item_found) break;
				
				// 해당 태그 요소 검색 (정규 표현식 사용)
				const tagRegex = new RegExp(`<${tag}[^>]*?contextRef="([^"]+)"[^>]*?(?:unitRef="([^"]+)")?[^>]*?(?:decimals="([^"]+)")?[^>]*?>(.*?)</${tag}>`, 'g');
				
				// 항목 유형에 맞는 패턴 선택
				const patterns = getPatternByItemType(item_name);
				
				// 각 보고서 유형별 패턴 시도
				for (const [report_type, pattern_code] of Object.entries(patterns)) {
					if (item_found) break;
					
					// 패턴 기반 정규식 생성
					const pattern_base = `CFY${fiscal_year}.${pattern_code}_ifrs-full_ConsolidatedAndSeparateFinancialStatementsAxis_ifrs-full_ConsolidatedMember`;
					const pattern_regex = new RegExp(`^${pattern_base}$`);
					
					// XBRL 문서에서 모든 매칭 찾기
					while ((match = tagRegex.exec(xbrl_content)) !== null) {
						const context_ref = match[1];
						const unit_ref = match[2];
						const decimals = match[3] || "0";
						const value_text = match[4];
						
						// 정규식으로 패턴 매칭 확인 (완전 일치)
						if (context_ref && pattern_regex.test(context_ref)) {
							if (value_text && unit_ref) {
								try {
									const formatted_value = formatNumericValue(value_text, decimals);
									extracted_data[item_name] = `${formatted_value} (${report_type})`;
									item_found = true;
									break;
								} catch (e) {
									console.error(`숫자 변환 실패 (${item_name}):`, e);
								}
							}
						}
					}
					
					if (item_found) break;
				}
				
				if (item_found) break;
			}
		}
	} catch (error) {
		console.error('XBRL 파싱 오류:', error);
		for (const key of Object.keys(items_and_tags)) {
			extracted_data[key] = "XBRL 파싱 오류";
		}
	}

	return extracted_data;
}

/**
 * 재무제표 원본파일(XBRL)을 다운로드하여 XBRL 텍스트를 반환하는 함수
 * @param rcept_no 공시 접수번호(14자리)
 * @param reprt_code 보고서 코드 (11011: 사업보고서, 11012: 반기보고서, 11013: 1분기보고서, 11014: 3분기보고서)
 * @returns 추출된 XBRL 텍스트 내용, 실패 시 오류 메시지 문자열
 */
async function getFinancialStatementXbrl(rcept_no: string, reprt_code: string): Promise<string> {
	try {
		const response = await axios.get(`${BASE_URL}/document.xml`, {
			params: {
				crtfc_key: API_KEY,
				rcept_no: rcept_no
			},
			responseType: 'arraybuffer'
		});
		
		if (response.status !== 200) {
			return `API 요청 실패: HTTP 상태 코드 ${response.status}`;
		}
		
		// API 오류 메시지 확인 시도 (XML 형식일 수 있음)
		try {
			const content = Buffer.from(response.data).toString('utf-8');
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: "",
				textNodeName: "#text"
			});
			const result = parser.parse(content);
			
			if (result.status && result.message) {
				return `DART API 오류: ${result.status} - ${result.message}`;
			}
		} catch (parseError) {
			// 파싱 오류는 정상적인 ZIP 파일일 수 있으므로 계속 진행
		}
		
		try {
			// ZIP 파일 처리
			const zip = new JSZip();
			const zipFile = await zip.loadAsync(response.data);
			
			// 압축 파일 내의 파일 목록
			const fileList = Object.keys(zipFile.files);
			
			if (fileList.length === 0) {
				return "ZIP 파일 내에 파일이 없습니다.";
			}
			
			// 파일명이 가장 짧은 파일 선택 (일반적으로 메인 파일일 가능성이 높음)
			const targetFile = fileList.reduce((prev, curr) => prev.length <= curr.length ? prev : curr);
			const fileExt = targetFile.split('.').pop()?.toLowerCase() || '';
			
			// 파일 내용 읽기
			const fileContent = await zipFile.file(targetFile)?.async('nodebuffer');
			
			if (!fileContent) {
				return "ZIP 파일에서 내용을 읽을 수 없습니다.";
			}
			
			// 텍스트 파일인 경우 (txt, html, htm, xml, xbrl 등)
			if (['txt', 'html', 'htm', 'xml', 'xbrl'].includes(fileExt)) {
				// 다양한 인코딩 시도
				const encodings = ['utf-8', 'euc-kr', 'cp949'];
				let textContent: string | null = null;
				
				for (const encoding of encodings) {
					try {
						// Node.js에서 EUC-KR 등의 인코딩은 iconv-lite와 같은 
						// 추가 라이브러리가 필요하지만, 여기서는 간단히 UTF-8만 시도
						textContent = fileContent.toString(encoding as BufferEncoding);
						break;
					} catch (e) {
						continue;
					}
				}
				
				if (textContent) {
					return textContent;
				} else {
					return "파일을 텍스트로 변환할 수 없습니다 (인코딩 문제).";
				}
			}
			// PDF 또는 기타 바이너리 파일
			else {
				return `파일이 텍스트 형식이 아닙니다 (형식: ${fileExt}).`;
			}
			
		} catch (error) {
			if (error instanceof Error) {
				return `다운로드한 파일이 유효한 ZIP 파일이 아닙니다: ${error.message}`;
			}
			return "다운로드한 파일이 유효한 ZIP 파일이 아닙니다.";
		}
		
	} catch (error) {
		if (axios.isAxiosError(error)) {
			return `API 요청 중 네트워크 오류 발생: ${error.message}`;
		}
		
		if (error instanceof Error) {
			return `공시 원본 다운로드 중 예상치 못한 오류 발생: ${error.message}`;
		}
		
		return "공시 원본 다운로드 중 알 수 없는 오류 발생";
	}
}

/**
 * 공시서류 원본파일 텍스트에서 특정 비즈니스 섹션만 추출하는 함수
 * @param document_text 공시서류 원본 텍스트
 * @param section_type 추출할 섹션 유형
 * @returns 추출된 섹션 텍스트 (태그 제거 및 정리된 상태)
 */
function extractBusinessSection(document_text: string, section_type: string): string {
	// SECTION 태그 형식 확인
	const section_tags = document_text.match(/<SECTION[^>]*>/g) || [];
	const section_end_tags = document_text.match(/<\/SECTION[^>]*>/g) || [];
	
	// TITLE 태그가 있는지 확인
	const title_tags: string[] = [];
	const title_regex = /<TITLE[^>]*>(.*?)<\/TITLE>/g;
	let title_match;
	while ((title_match = title_regex.exec(document_text)) !== null) {
		title_tags.push(title_match[1]);
	}
	
	// 섹션 타입별 패턴 매핑 (번호가 포함된 경우도 처리)
	const section_patterns: Record<string, RegExp> = {
		'사업의 개요': /<TITLE[^>]*>(?:\d+\.\s*)?사업의\s*개요[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'주요 제품 및 서비스': /<TITLE[^>]*>(?:\d+\.\s*)?주요\s*제품[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'원재료 및 생산설비': /<TITLE[^>]*>(?:\d+\.\s*)?원재료[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'매출 및 수주상황': /<TITLE[^>]*>(?:\d+\.\s*)?매출[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'위험관리 및 파생거래': /<TITLE[^>]*>(?:\d+\.\s*)?위험관리[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'주요계약 및 연구개발활동': /<TITLE[^>]*>(?:\d+\.\s*)?주요\s*계약[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
		'기타 참고사항': /<TITLE[^>]*>(?:\d+\.\s*)?기타\s*참고사항[^<]*<\/TITLE>(.*?)(?=<TITLE|<\/SECTION)/i,
	};
	
	// 요청된 섹션 패턴 확인
	if (!section_patterns[section_type]) {
		return `지원하지 않는 섹션 유형입니다. 지원되는 유형: ${Object.keys(section_patterns).join(', ')}`;
	}
	
	// 해당 섹션과 일치하는 제목 찾기
	const section_keyword = section_type.split(' ')[0].toLowerCase();
	const matching_titles = title_tags.filter(title => title.toLowerCase().includes(section_keyword));
	
	// 정규표현식 패턴으로 섹션 추출 시도 1: 기본 패턴
	let matches = section_patterns[section_type].exec(document_text);
	
	// 정규표현식 패턴으로 섹션 추출 시도 2: SECTION 태그 종료 패턴 수정
	if (!matches) {
		// SECTION-숫자 형태의 종료 태그 지원
		const modified_pattern = new RegExp(section_patterns[section_type].source.replace('</SECTION', '</SECTION(?:-\\d+)?'), 'i');
		matches = modified_pattern.exec(document_text);
	}
	
	// 정규표현식 패턴으로 섹션 추출 시도 3: 개별 TITLE 직접 검색
	if (!matches && matching_titles.length > 0) {
		for (const title of matching_titles) {
			// 제목 문자열을 정규 표현식에서 사용하기 위해 이스케이프 처리
			const escaped_title = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const direct_pattern = new RegExp(`<TITLE[^>]*>${escaped_title}</TITLE>(.*?)(?=<TITLE|</SECTION(?:-\\d+)?)`, 'i');
			matches = direct_pattern.exec(document_text);
			if (matches) {
				break;
			}
		}
	}
	
	if (!matches) {
		return `'${section_type}' 섹션을 찾을 수 없습니다.`;
	}
	
	// 추출된 텍스트
	let section_text = matches[1];
	
	// 태그 제거 및 텍스트 정리
	section_text = section_text.replace(/<[^>]*>/g, ' ');  // HTML 태그 제거
	section_text = section_text.replace(/USERMARK\s*=\s*"[^"]*"/g, '');  // USERMARK 제거
	section_text = section_text.replace(/\s+/g, ' ');  // 연속된 공백 제거
	section_text = section_text.replace(/\n\s*\n/g, '\n\n');  // 빈 줄 처리
	section_text = section_text.trim();  // 앞뒤 공백 제거
	
	return section_text;
}

/**
 * DART API를 통해 공시서류를 다운로드하고 특정 비즈니스 섹션만 추출하는 함수
 * @param rcept_no 공시 접수번호(14자리)
 * @param section_type 추출할 섹션 유형
 * @returns 추출된 섹션 텍스트 또는 오류 메시지
 */
async function extractBusinessSectionFromDart(rcept_no: string, section_type: string): Promise<string> {
	// 원본 문서 다운로드
	const document_text = await getFinancialStatementXbrl(rcept_no, determineReportCode(section_type) || "");
	
	// 섹션 추출
	const section_text = extractBusinessSection(document_text, section_type);
	
	return section_text;
}

/**
 * DART API를 통해 단일회사 전체 재무제표를 JSON 형태로 가져오는 함수
 * @param corp_code 회사 고유번호(8자리)
 * @param bsns_year 사업연도(4자리) 예: "2023"
 * @param reprt_code 보고서 코드 (11011: 사업보고서, 11012: 반기보고서, 11013: 1분기보고서, 11014: 3분기보고서)
 * @param fs_div 개별/연결구분 (OFS:재무제표, CFS:연결재무제표)
 * @returns [재무 데이터 리스트, 오류 메시지] 튜플. 성공 시 [리스트, null], 실패 시 [빈 리스트, 오류 메시지]
 */
async function getFinancialJson(
	corp_code: string, 
	bsns_year: string, 
	reprt_code: string, 
	fs_div: string = "OFS"
): Promise<[any[], string | null]> {
	try {
		const response = await axios.get(`${BASE_URL}/fnlttSinglAcntAll.json`, {
			params: {
				crtfc_key: API_KEY,
				corp_code: corp_code,
				bsns_year: bsns_year,
				reprt_code: reprt_code,
				fs_div: fs_div
			}
		});
		
		if (response.status !== 200) {
			return [[], `API 요청 실패: HTTP 상태 코드 ${response.status}`];
		}
		
		const result = response.data;
		
		if (result.status !== '000') {
			const status = result.status || '알 수 없음';
			const msg = result.message || '알 수 없는 오류';
			return [[], `DART API 오류: ${status} - ${msg}`];
		}
		
		return [result.list || [], null];
		
	} catch (error) {
		if (axios.isAxiosError(error)) {
			return [[], `API 요청 중 네트워크 오류 발생: ${error.message}`];
		}
		
		if (error instanceof Error) {
			return [[], `재무 데이터 조회 중 예상치 못한 오류 발생: ${error.message}`];
		}
		
		return [[], "알 수 없는 오류로 재무 데이터를 조회할 수 없습니다."];
	}
}

// MyMCP 클래스 정의
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "DART Financial Data",
		version: "1.0.0",
	});

	async init() {
		// 현재 날짜를 YYYYMMDD 형식으로 반환하는 도구
		this.server.tool(
			"get_current_date",
			"현재 날짜를 YYYYMMDD 형식으로 반환합니다.",
			{},
			async () => {
				// 현재 날짜를 YYYYMMDD 형식으로 포맷팅
				const now = new Date();
				const year = now.getFullYear();
				const month = String(now.getMonth() + 1).padStart(2, '0');
				const day = String(now.getDate()).padStart(2, '0');
				const formattedDate = `${year}${month}${day}`;
				
				return {
					content: [{ type: "text", text: formattedDate }]
				};
			}
		);
		
		// 회사의 주요 재무 정보를 검색하여 제공하는 도구
		this.server.tool(
			"search_disclosure",
			"회사의 주요 재무 정보를 검색하여 제공합니다. 특정 기간 동안의 공시 자료에서 재무 데이터를 추출합니다.",
			{
				company_name: z.string().describe("회사명 (예: 삼성전자, 네이버 등)"),
				start_date: z.string().describe("시작일 (YYYYMMDD 형식, 예: 20230101)"),
				end_date: z.string().describe("종료일 (YYYYMMDD 형식, 예: 20231231)"),
				requested_items: z.array(z.string()).optional().describe("사용자가 요청한 재무 항목 이름 리스트 (예: [\"매출액\", \"영업이익\"]). 없으면 모든 주요 항목을 대상으로 함.")
			},
			async ({ company_name, start_date, end_date, requested_items }) => {
				let result = "";
				
				try {
					// 진행 상황 알림
					let info_msg = `${company_name}의`;
					if (requested_items && requested_items.length > 0) {
						info_msg += ` ${requested_items.join(', ')} 관련`;
					}
					info_msg += " 재무 정보를 검색합니다.";
					console.log(info_msg);
					
					// end_date 조정
					const original_end_date = end_date;
					const [adjusted_end_date, was_adjusted] = adjustEndDate(end_date);
					
					if (was_adjusted) {
						console.log(`공시 제출 기간을 고려하여 검색 종료일을 ${original_end_date}에서 ${adjusted_end_date}로 자동 조정했습니다.`);
						end_date = adjusted_end_date;
					}
					
					// 회사 코드 조회
					const [corp_code, matched_name] = await getCorpCodeByName(company_name);
					if (!corp_code) {
						return {
							content: [{ type: "text", text: `회사 검색 오류: ${matched_name}` }]
						};
					}
					
					console.log(`${matched_name}(고유번호: ${corp_code})의 공시를 검색합니다.`);
					
					// 공시 목록 조회
					const [disclosures, error_msg] = await getDisclosureList(corp_code, start_date, end_date);
					if (error_msg) {
						return {
							content: [{ type: "text", text: `공시 목록 조회 오류: ${error_msg}` }]
						};
					}
					
					if (disclosures.length === 0) {
						let date_range_msg = `${start_date}부터 ${end_date}까지`;
						if (was_adjusted) {
							date_range_msg += ` (원래 요청: ${start_date}~${original_end_date}, 공시 제출 기간 고려하여 확장)`;
						}
						return {
							content: [{ type: "text", text: `${date_range_msg} '${matched_name}'(고유번호: ${corp_code})의 정기공시가 없습니다.` }]
						};
					}
					
					console.log(`${disclosures.length}개의 정기공시를 찾았습니다. XBRL 데이터 조회 및 분석을 시도합니다.`);
					
					// 추출할 재무 항목 및 가능한 태그 리스트 정의
					const all_items_and_tags: Record<string, string[]> = {
						"매출액": ["ifrs-full:Revenue"],
						"영업이익": ["dart:OperatingIncomeLoss"],
						"당기순이익": ["ifrs-full:ProfitLoss"],
						"영업활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInOperatingActivities"],
						"투자활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInInvestingActivities"],
						"재무활동 현금흐름": ["ifrs-full:CashFlowsFromUsedInFinancingActivities"],
						"자산총계": ["ifrs-full:Assets"],
						"부채총계": ["ifrs-full:Liabilities"],
						"자본총계": ["ifrs-full:Equity"]
					};
					
					// 사용자가 요청한 항목만 추출하도록 구성
					let items_to_extract: Record<string, string[]>;
					if (requested_items && requested_items.length > 0) {
						items_to_extract = {};
						for (const item of requested_items) {
							if (all_items_and_tags[item]) {
								items_to_extract[item] = all_items_and_tags[item];
							}
						}
						
						if (Object.keys(items_to_extract).length === 0) {
							const unsupported_items = requested_items.filter(item => !all_items_and_tags[item]);
							return {
								content: [{ 
										type: "text",
									text: `요청하신 항목 중 지원되지 않는 항목이 있습니다: ${unsupported_items.join(', ')}. 지원 항목: ${Object.keys(all_items_and_tags).join(', ')}` 
								}]
							};
						}
					} else {
						items_to_extract = all_items_and_tags;
					}
					
					// 결과 문자열 초기화
					result = `# ${matched_name} 주요 재무 정보 (${start_date} ~ ${end_date})\n`;
					if (requested_items && requested_items.length > 0) {
						result += `(${requested_items.join(', ')} 관련)\n`;
					}
					result += "\n";
					
					// 최대 5개의 공시만 처리 (API 호출 제한 및 시간 고려)
					const disclosure_count = Math.min(5, disclosures.length);
					let processed_count = 0;
					let relevant_reports_found = 0;
					const api_errors: string[] = [];
					
					// 각 공시별 처리
					for (const disclosure of disclosures.slice(0, disclosure_count)) {
						const report_name = disclosure.report_nm || '제목 없음';
						const rcept_dt = disclosure.rcept_dt || '날짜 없음';
						const rcept_no = disclosure.rcept_no || '';
						
						// 보고서 코드 결정
						const reprt_code = determineReportCode(report_name);
						if (!rcept_no || !reprt_code) {
							continue;
						}
						
						// 진행 상황 보고
						processed_count += 1;
						console.log(`공시 ${processed_count}/${disclosure_count} 분석 중: ${report_name} (접수번호: ${rcept_no})`);
						
						// XBRL 데이터 조회
						try {
							const xbrl_text = await getFinancialStatementXbrl(rcept_no, reprt_code);
							
							// XBRL 파싱 및 데이터 추출
							let financial_data: FinancialData = {};
							let parse_error: Error | null = null;
							
							if (!xbrl_text.startsWith("DART API 오류:") && 
								!xbrl_text.startsWith("API 요청 실패:") && 
								!xbrl_text.startsWith("ZIP 파일") && 
								!xbrl_text.startsWith("<인코딩 오류:")) {
								try {
									financial_data = parseXbrlFinancialData(xbrl_text, items_to_extract);
								} catch (e) {
									parse_error = e instanceof Error ? e : new Error(String(e));
									console.warn(`XBRL 파싱/분석 중 오류 발생 (${report_name}): ${parse_error}`);
									financial_data = Object.fromEntries(
										Object.keys(items_to_extract).map(key => [key, "분석 중 예외 발생"])
									);
								}
							} else if (xbrl_text.startsWith("DART API 오류: 013")) {
								financial_data = Object.fromEntries(
									Object.keys(items_to_extract).map(key => [key, "데이터 없음(API 013)"])
								);
							} else {
								const error_summary = xbrl_text.split('\n')[0].substring(0, 100);
								financial_data = Object.fromEntries(
									Object.keys(items_to_extract).map(key => [key, `오류(${error_summary})`])
								);
								api_errors.push(`${report_name}: ${error_summary}`);
							}
							
							// 요청된 항목 관련 데이터가 있는지 확인
							let is_relevant = true;
							if (requested_items && requested_items.length > 0) {
								is_relevant = requested_items.some(item => 
									financial_data[item] && 
									!INVALID_VALUE_INDICATORS.has(financial_data[item]) &&
									!financial_data[item].startsWith("오류(") &&
									!financial_data[item].startsWith("분석 중")
								);
							}
							
							// 관련 데이터가 있는 공시만 결과에 추가
							if (is_relevant) {
								relevant_reports_found += 1;
								result += `## ${report_name} (${rcept_dt})\n`;
								result += `접수번호: ${rcept_no}\n\n`;
								
								if (Object.keys(financial_data).length > 0) {
									for (const [item, value] of Object.entries(financial_data)) {
										result += `- ${item}: ${value}\n`;
									}
								} else if (parse_error) {
									result += `- XBRL 분석 중 오류 발생: ${parse_error}\n`;
								} else {
									result += "- 주요 재무 정보를 추출하지 못했습니다.\n";
								}
								
								result += "\n" + "-".repeat(50) + "\n\n";
							} else {
								console.log(`[${report_name}] 건너뜀: 요청하신 항목(${requested_items ? requested_items.join(', ') : '전체'}) 관련 유효 데이터 없음.`);
							}
						} catch (e) {
							const error_message = e instanceof Error ? e.message : String(e);
							console.error(`공시 처리 중 예상치 못한 오류 발생 (${report_name}): ${error_message}`);
							api_errors.push(`${report_name}: ${error_message}`);
							console.error(`공시 처리 중 예상치 못한 오류 발생:`, e);
						}
					}
					
					// 최종 결과 메시지 추가
					if (api_errors.length > 0) {
						result += "\n## 처리 중 발생한 오류\n";
						for (const error of api_errors) {
							result += `- ${error}\n`;
						}
						result += "\n";
					}
					
					if (relevant_reports_found === 0 && processed_count > 0) {
						const no_data_reason = requested_items && requested_items.length > 0 ? 
							"요청하신 항목 관련 유효한 데이터를 찾지 못했거나" : 
							"주요 재무 데이터를 찾지 못했거나";
						result += `※ 처리된 공시에서 ${no_data_reason}, 데이터가 제공되지 않는 보고서일 수 있습니다.\n`;
					} else if (processed_count === 0 && disclosures.length > 0) {
						result += "조회된 정기공시가 있으나, XBRL 데이터를 포함하는 보고서 유형(사업/반기/분기)이 아니거나 처리 중 오류가 발생했습니다.\n";
					}
					
					if (disclosures.length > disclosure_count) {
						result += `※ 총 ${disclosures.length}개의 정기공시 중 최신 ${disclosure_count}개에 대해 분석을 시도했습니다.\n`;
					}
					
					if (relevant_reports_found > 0 && requested_items && requested_items.length > 0) {
						result += `\n※ 요청하신 항목(${requested_items.join(', ')}) 관련 정보가 있는 ${relevant_reports_found}개의 보고서를 표시했습니다.\n`;
					}
					
					result += chat_guideline;
					
				} catch (error) {
					const error_message = error instanceof Error ? error.message : String(error);
					const stack_trace = error instanceof Error && error.stack ? error.stack : "";
					return {
						content: [{ 
							type: "text", 
							text: `재무 정보 검색 중 예상치 못한 오류가 발생했습니다: ${error_message}\n\n${stack_trace}` 
						}],
						isError: true
					};
				}
				
				return {
					content: [{ type: "text", text: result.trim() }]
				};
			}
		);

		// 회사의 사업 관련 현황 정보를 제공하는 도구
		this.server.tool(
			"search_business_information",
			"회사의 사업보고서에서 특정 사업 관련 섹션의 정보를 추출하여 제공합니다.",
			{
				company_name: z.string().describe("회사명 (예: 삼성전자, 네이버 등)"),
				section_type: z.enum([
					"사업의 개요", 
					"주요 제품 및 서비스", 
					"원재료 및 생산설비", 
					"매출 및 수주상황", 
					"위험관리 및 파생거래", 
					"주요계약 및 연구개발활동", 
					"기타 참고사항"
				]).describe("조회할 사업 항목 섹션")
			},
			async ({ company_name, section_type }) => {
				let result = "";
				
				try {
					console.log(`${company_name}의 ${section_type} 정보를 검색합니다.`);
					
					// 현재 날짜 기준으로 1년 전부터 현재까지 공시 검색
					const now = new Date();
					const end_date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
					
					const start_date_obj = new Date(now);
					start_date_obj.setFullYear(start_date_obj.getFullYear() - 1);  // 1년 전
					const start_date = `${start_date_obj.getFullYear()}${String(start_date_obj.getMonth() + 1).padStart(2, '0')}${String(start_date_obj.getDate()).padStart(2, '0')}`;
					
					// 회사 코드 조회
					const [corp_code, matched_name] = await getCorpCodeByName(company_name);
					if (!corp_code) {
						return {
							content: [{ type: "text", text: `회사 검색 오류: ${matched_name}` }]
						};
					}
					
					console.log(`${matched_name}(고유번호: ${corp_code})의 공시를 검색합니다.`);
					
					// 공시 목록 조회
					const [disclosures, error_msg] = await getDisclosureList(corp_code, start_date, end_date);
					if (error_msg) {
						return {
							content: [{ type: "text", text: `공시 목록 조회 오류: ${error_msg}` }]
						};
					}
					
					if (disclosures.length === 0) {
						return {
							content: [{ type: "text", text: `${start_date}부터 ${end_date}까지 '${matched_name}'(고유번호: ${corp_code})의 정기공시가 없습니다.` }]
						};
					}
					
					console.log(`${disclosures.length}개의 정기공시를 찾았습니다. 사업보고서 검색 중...`);
					
					// 결과 문자열 초기화
					result = `# ${matched_name} ${section_type} 정보\n\n`;
					
					// 사업보고서 우선, 없으면 분기/반기 보고서 사용
					const prioritized_disclosures = disclosures
						.sort((a, b) => {
							const a_is_business = a.report_nm?.includes('사업보고서') ? 1 : 0;
							const b_is_business = b.report_nm?.includes('사업보고서') ? 1 : 0;
							return b_is_business - a_is_business;  // 사업보고서 우선
						});
					
					let section_content = "";
					let section_found = false;
					
					// 최대 3개의 공시만 확인 (성능 및 시간 고려)
					for (const disclosure of prioritized_disclosures.slice(0, 3)) {
						const report_name = disclosure.report_nm || '제목 없음';
						const rcept_dt = disclosure.rcept_dt || '날짜 없음';
						const rcept_no = disclosure.rcept_no || '';
						
						if (!rcept_no) continue;
						
						console.log(`공시 검토 중: ${report_name} (${rcept_dt}, 접수번호: ${rcept_no})`);
						
						try {
							// 원본 문서에서 특정 섹션 추출
							const section_text = await extractBusinessSectionFromDart(rcept_no, section_type);
							
							// 오류 메시지 확인 또는 내용이 너무 짧은 경우
							if (section_text.startsWith('오류:') || 
								section_text.includes('섹션을 찾을 수 없습니다') || 
								section_text.length < 30) {
								console.log(`[${report_name}] ${section_type} 섹션을 찾지 못했거나 내용이 부족합니다.`);
								continue;
							}
							
							// 섹션을 찾았으면 검색 종료
							section_content = section_text;
							section_found = true;
							
							result += `## ${report_name} (${rcept_dt})\n`;
							result += `### ${section_type}\n\n`;
							result += `${section_content}\n\n`;
							
							console.log(`[${report_name}] ${section_type} 섹션 추출 성공 (길이: ${section_content.length}자)`);
						break;
						} catch (e) {
							const error_message = e instanceof Error ? e.message : String(e);
							console.error(`공시 처리 중 예상치 못한 오류 발생 (${report_name}): ${error_message}`);
						}
					}
					
					if (!section_found) {
						result = `${matched_name}의 최근 공시에서 ${section_type} 정보를 찾을 수 없습니다. 회사 이름을 정확히 입력하셨는지, 그리고 해당 섹션이 존재하는지 확인해 주세요.`;
					}
					
				} catch (error) {
					const error_message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ 
							type: "text", 
							text: `사업 정보 검색 중 예상치 못한 오류가 발생했습니다: ${error_message}` 
						}],
						isError: true
					};
				}
				
				return {
					content: [{ type: "text", text: result.trim() }]
				};
			}
		);

		// 회사의 세부적인 재무 정보를 제공하는 도구
		this.server.tool(
			"search_detailed_financial_data",
			"회사의 세부적인 재무제표 정보를 제공합니다. 특정 연도의 재무상태표, 손익계산서, 현금흐름표 등을 조회합니다.",
			{
				company_name: z.string().describe("회사명 (예: 삼성전자, 네이버 등)"),
				statement_type: z.enum(["재무상태표", "손익계산서", "현금흐름표"]).describe("조회할 재무제표 유형"),
				year: z.string().describe("조회 연도 (YYYY 형식, 예: 2023)"),
				is_consolidated: z.boolean().optional().describe("연결 재무제표 여부 (기본값: true)")
			},
			async ({ company_name, statement_type, year, is_consolidated }) => {
				let result = "";
				
				try {
					// 기본값 설정
					const consolidation = is_consolidated === false ? false : true;
					const fs_div = consolidation ? "CFS" : "OFS";  // CFS: 연결재무제표, OFS: 개별재무제표
					const consol_text = consolidation ? "연결" : "개별";
					
					console.log(`${company_name}의 ${year}년 ${consol_text} ${statement_type}를 검색합니다.`);
					
					// 회사 코드 조회
					const [corp_code, matched_name] = await getCorpCodeByName(company_name);
					if (!corp_code) {
						return {
							content: [{ type: "text", text: `회사 검색 오류: ${matched_name}` }]
						};
					}
					
					// 사업보고서 코드 사용
					const reprt_code = REPORT_CODE["사업보고서"];  // 11011
					
					console.log(`${matched_name}(고유번호: ${corp_code})의 ${year}년 ${statement_type} 데이터를 조회합니다.`);
					
					// 재무제표 유형 코드 결정
					const sj_div = STATEMENT_TYPES[statement_type];
					if (!sj_div) {
						return {
							content: [{ type: "text", text: `지원하지 않는 재무제표 유형입니다: ${statement_type}` }]
						};
					}
					
					// API 호출로 재무 데이터 조회
					const [financial_data, error_msg] = await getFinancialJson(corp_code, year, reprt_code, fs_div);
					if (error_msg) {
						return {
							content: [{ type: "text", text: `재무 데이터 조회 오류: ${error_msg}` }]
						};
					}
					
					if (financial_data.length === 0) {
						return {
							content: [{ type: "text", text: `${year}년 ${matched_name}의 ${consol_text} ${statement_type} 데이터가 없습니다.` }]
						};
					}
					
					// 결과 문자열 초기화
					result = `# ${matched_name} ${year}년 ${consol_text} ${statement_type}\n\n`;
					
					// 해당 유형의 재무제표만 필터링
					const filtered_data = financial_data.filter(item => item.sj_div === sj_div);
					
					if (filtered_data.length === 0) {
						return {
							content: [{ type: "text", text: `${year}년 ${matched_name}의 ${consol_text} ${statement_type} 데이터가 없습니다.` }]
						};
					}
					
					// 항목 이름과 값을 정리하여 표시
					let items_added = 0;
					
					// 계정과목 이름을 기준으로 정렬
					filtered_data.sort((a, b) => {
						const account_a = a.account_nm || "";
						const account_b = b.account_nm || "";
						return account_a.localeCompare(account_b);
					});
					
					// 각 항목별 처리
					result += `| 계정과목 | 금액 (단위: 원) | 비고 |\n`;
					result += `|---------|---------------|------|\n`;
					
					for (const item of filtered_data) {
						const account_name = item.account_nm || "항목명 없음";
						const amount = item.thstrm_amount || "-";
						const comment = item.thstrm_add_amount || "";
						
						// 너무 깊은 하위 항목 제외 (첫 글자 공백 개수로 판단)
						let leading_spaces = 0;
						for (let i = 0; i < account_name.length; i++) {
							if (account_name[i] === ' ') leading_spaces++;
							else break;
						}
						
						// 들여쓰기가 많을수록 상세 항목이므로, 들여쓰기가 3단계 이하인 항목만 표시
						if (leading_spaces <= 6) {
							result += `| ${account_name} | ${amount} | ${comment} |\n`;
							items_added++;
						}
					}
					
					if (items_added === 0) {
						result += "데이터가 제공되지 않거나 항목이 없습니다.\n";
					} else {
						result += `\n※ 총 ${filtered_data.length}개 항목 중 주요 ${items_added}개 항목을 표시했습니다.\n`;
					}
					
					result += `\n데이터 출처: 금융감독원 DART (${year}년 사업보고서 기준)\n`;
					
				} catch (error) {
					const error_message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ 
							type: "text", 
							text: `재무 데이터 검색 중 예상치 못한 오류가 발생했습니다: ${error_message}` 
						}],
						isError: true
					};
				}
				
				return {
					content: [{ type: "text", text: result.trim() }]
				};
			}
		);

		// JSON API를 통한 재무 정보 검색 도구 (XBRL 대안 도구)
		this.server.tool(
			"search_json_financial_data",
			"재무제표 원본파일(JSON)을 다운로드하여 재무 데이터를 제공합니다. XBRL 파싱 방식보다 더 안정적으로 재무 정보를 조회할 수 있습니다.",
			{
				company_name: z.string().describe("회사명 (예: 삼성전자, 네이버 등)"),
				bsns_year: z.string().describe("사업연도 (YYYY 형식, 예: 2023)"),
				reprt_code: z.string().optional().describe("보고서 코드 (11011: 사업보고서, 11012: 반기보고서, 11013: 1분기보고서, 11014: 3분기보고서)"),
				fs_div: z.string().optional().describe("개별/연결구분 (OFS:재무제표, CFS:연결재무제표)")
			},
			async ({ company_name, bsns_year, reprt_code, fs_div }) => {
				let result = "";
				
				try {
					// 기본값 설정
					const report_code = reprt_code || REPORT_CODE["사업보고서"];  // 기본값: 사업보고서
					const financial_statement_div = fs_div || "CFS";  // 기본값: 연결재무제표
					const fs_div_text = financial_statement_div === "CFS" ? "연결" : "개별";
					
					console.log(`${company_name}의 ${bsns_year}년 ${fs_div_text} 재무제표를 검색합니다.`);
					
					// 회사 코드 조회
					const [corp_code, matched_name] = await getCorpCodeByName(company_name);
					if (!corp_code) {
						return {
							content: [{ type: "text", text: `회사 검색 오류: ${matched_name}` }]
						};
					}
					
					console.log(`${matched_name}(고유번호: ${corp_code})의 ${bsns_year}년 재무 데이터를 조회합니다.`);
					
					// API 호출로 재무 데이터 조회
					const [financial_data, error_msg] = await getFinancialJson(corp_code, bsns_year, report_code, financial_statement_div);
					if (error_msg) {
						return {
							content: [{ type: "text", text: `재무 데이터 조회 오류: ${error_msg}` }]
						};
					}
					
					if (financial_data.length === 0) {
						return {
							content: [{ type: "text", text: `${bsns_year}년 ${matched_name}의 ${fs_div_text} 재무제표 데이터가 없습니다.` }]
						};
					}
					
					// 결과 문자열 초기화
					result = `# ${matched_name} ${bsns_year}년 ${fs_div_text} 재무제표\n\n`;
					
					// 재무제표 유형별로 그룹화
					const statement_groups: Record<string, any[]> = {};
					for (const item of financial_data) {
						const sj_div = item.sj_div || "기타";
						if (!statement_groups[sj_div]) {
							statement_groups[sj_div] = [];
						}
						statement_groups[sj_div].push(item);
					}
					
					// 재무제표 유형별로 정보 출력
					for (const [sj_div, items] of Object.entries(statement_groups)) {
						const statement_name = getStatementName(sj_div);
						result += `## ${statement_name}\n\n`;
						
						// 항목별 테이블 형식으로 출력
						result += "| 계정명 | 금액 (원) | 비고 |\n";
						result += "|------|-----------|------|\n";
						
						for (const item of items) {
							const account_name = item.account_nm || "계정명 없음";
							const amount = item.thstrm_amount ? Number(item.thstrm_amount).toLocaleString() : "-";
							const note = item.account_detail || "";
							
							result += `| ${account_name} | ${amount} | ${note} |\n`;
						}
						
						result += "\n";
					}
					
				} catch (error) {
					const error_message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ 
							type: "text", 
							text: `재무 데이터 검색 중 예상치 못한 오류가 발생했습니다: ${error_message}` 
						}],
						isError: true
					};
				}
				
				return {
					content: [{ type: "text", text: result.trim() }]
				};
			}
		);
	}
}

export default {
	fetch(request: Request, env: any, ctx: any) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			// @ts-ignore
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			// @ts-ignore
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
