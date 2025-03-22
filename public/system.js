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
// 非同期エラー（Promiseの未処理拒否）をキャッチするためのイベントリスナー
window.addEventListener('unhandledrejection', function(event) {
	parent.postMessage({
			type: 'iframeError',
			message: event.reason,
			lineno:'-',
			colno:'-'
		}, '*');
		// ブラウザのデフォルト動作（警告表示など）を防ぎたい場合はpreventDefault()を呼び出す
		event.preventDefault();
});
}