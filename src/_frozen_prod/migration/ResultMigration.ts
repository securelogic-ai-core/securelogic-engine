export interface ResultMigration<TFrom, TTo> {
  fromVersion: string;
  toVersion: string;

  migrate(input: TFrom): TTo;
}
