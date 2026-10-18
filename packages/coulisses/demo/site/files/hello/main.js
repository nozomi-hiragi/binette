export function mount(el, sh) {
  const main = document.createElement("main");
  const title = document.createElement("h1");
  title.textContent = "サンプル";
  const message = document.createElement("p");
  message.textContent = "こんにちは。";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "ホームへ戻る";
  const navigate = () => sh.navigate("/home");
  button.addEventListener("click", navigate);
  main.append(title, message, button);
  el.append(main);
  return () => {
    button.removeEventListener("click", navigate);
    main.remove();
  };
}
