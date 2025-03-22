// グローバルエラーハンドラを設定
if(parent) {
window.onerror = function(message, source, lineno, colno, error) {
	// 親へpostMessageでエラー情報を送信
	parent.postMessage({
		type: 'iframeError',
		message: message,
		source: source,
		lineno: lineno,
		colno: colno,
		error: error ? error.toString() : null
	}, '*');
	return true;
};
}