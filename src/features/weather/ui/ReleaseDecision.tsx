import type { Shift } from "../../../shared/types";
import { clockExact, countdownLabel } from "../../../shared/document";
import {
  PUSH_SECONDS,
  chooseRiskRelease,
  chooseWaitRelease,
  releaseOutlook,
} from "../lib/release";

export function ReleaseDecision({
  state,
  onChange,
}: {
  state: Shift;
  onChange: (updater: (s: Shift) => Shift) => void;
}) {
  const flight = state.flights.find((f) => f.id === state.selectedFlightId);
  if (!flight) return null;
  const outlook = releaseOutlook(state, flight);
  const attempt = flight.releaseAttempt;
  const plan = flight.releasePlan;
  if (attempt) {
    const remain = attempt.resolveAt - state.time;
    return (
      <div className="release-decision pending">
        <div className="release-badge">风险推出 · 判定中</div>
        <p>
          {flight.id} 正在争取窗口：把握{" "}
          <b>{Math.round(attempt.chance * 100)}%</b> · {countdownLabel(remain)}{" "}
          后见分晓
        </p>
        <small>结果在做出决定时已固定，暂停或加速都不会重新抽取。</small>
      </div>
    );
  }
  if (plan) {
    return (
      <div className="release-decision waiting">
        <div className="release-badge">保守等待 · 已排程</div>
        <p>
          {flight.id} 等待天气窗口结束，预计{" "}
          <b>{clockExact(plan.until)}</b> 后自动放行
        </p>
        <small>若预报上限过去仍未消散，等待将顺延，需重新评估。</small>
      </div>
    );
  }
  if (!outlook.hasDecision) return null;
  if (outlook.cooldownUntil !== undefined) {
    return (
      <div className="release-decision cooldown">
        <div className="release-badge">推出复盘 · 冷却中</div>
        <p>
          {flight.id} 刚经历一次中断推出，机组需重新简报，{" "}
          <b>{countdownLabel(outlook.cooldownUntil - state.time)}</b> 后可再次决策
        </p>
        <small>在冷却期间，可先完成或重新安排除冰、地勤等保障。</small>
      </div>
    );
  }
  const blockedByStorms = !outlook.risk && outlook.reason;
  return (
    <div className="release-decision">
      <div className="subheading">
        <h3>放行决策</h3>
        <span>RELEASE WINDOW</span>
      </div>
      <div className="release-options">
        {outlook.risk ? (
          <button
            className="release-option risk"
            data-testid="release-risk"
            onClick={() => onChange((s) => chooseRiskRelease(s, flight.id))}
          >
            <div className="release-option-head">
              <strong>冒险争取窗口</strong>
              <b>{Math.round(outlook.risk.chance * 100)}%</b>
            </div>
            <p>{outlook.risk.note}</p>
            <ul>
              <li className="gain">
                成功：窗口内推出，+{outlook.risk.successBonus} 分
              </li>
              <li className="risk-loss">
                失败：推出中止，-{outlook.risk.failurePenalty} 分，约延误{" "}
                {outlook.risk.failureDelay}s
              </li>
              <li className="muted">
                预计损失 {outlook.risk.loss} 分 · 窗口关闭{" "}
                {clockExact(outlook.risk.windowEnd)}
              </li>
            </ul>
            <span className="option-cta">选项 1 · 立即执行</span>
          </button>
        ) : (
          <div className="release-option disabled">
            <div className="release-option-head">
              <strong>冒险争取窗口</strong>
              <b>不可用</b>
            </div>
            <p>{blockedByStorms ?? "当前没有可争取的窗口"}</p>
            <span className="option-cta">不要在雷雨中推出</span>
          </div>
        )}
        {outlook.wait && (
          <button
            className="release-option wait"
            data-testid="release-wait"
            onClick={() => onChange((s) => chooseWaitRelease(s, flight.id))}
          >
            <div className="release-option-head">
              <strong>保守等待天气</strong>
              <b>稳妥</b>
            </div>
            <p>{outlook.wait.note}</p>
            <ul>
              <li className="risk-loss">
                预计延误 {countdownLabel(outlook.wait.delay)}，损失{" "}
                {outlook.wait.loss} 分
              </li>
              <li className="muted">
                预计 {clockExact(outlook.wait.until)} 后窗口结束
              </li>
            </ul>
            <span className="option-cta">选项 2 · 自动排程</span>
          </button>
        )}
      </div>
      <p className="release-note">
        风险推出在 {PUSH_SECONDS}s 内给出结果；保守等待会在天气解除后自动放行，
        但等待中过期的除冰保护不会恢复。
      </p>
    </div>
  );
}
