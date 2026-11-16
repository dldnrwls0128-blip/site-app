/**
 * Web Speech API 음성 입력.
 * Chromium 계열은 원격 인식 서버를 쓰는 경우가 많아 오프라인에서 실패할 수 있다.
 * 텍스트 입력 폴백을 항상 함께 제공한다.
 */

export function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startDictation({ onText, onError, onEnd, lang = "ko-KR" } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    onError?.("unsupported");
    return null;
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (ev) => {
    let text = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      text += ev.results[i][0].transcript;
    }
    onText?.(text, ev.results[ev.results.length - 1].isFinal);
  };
  rec.onerror = (ev) => onError?.(ev.error || "error");
  rec.onend = () => onEnd?.();
  try {
    rec.start();
  } catch (e) {
    onError?.(e?.message || "start-failed");
    return null;
  }
  return rec;
}
