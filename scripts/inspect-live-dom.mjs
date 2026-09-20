const endpoint = "ws://127.0.0.1:53287/devtools/page/8447385ABDA10DD1069D6949F2620831";
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const response = await new Promise((resolve, reject) => {
  socket.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true });
  socket.addEventListener("error", reject, { once: true });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `JSON.stringify([...document.querySelectorAll('*')]
        .filter((element) => element.children.length === 0 && element.textContent.includes('Thought for'))
        .slice(0, 5)
        .map((element) => ({ text: element.textContent, html: element.parentElement?.parentElement?.outerHTML.slice(0, 3000) })))` ,
      returnByValue: true,
    },
  }));
});
socket.close();
console.log(response.result.result.value);
